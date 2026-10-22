#!/usr/bin/env bash
# Two emulators chat, one goes offline, comes back and catches up.
#
# Before running:
#   1. The server is running on this Mac with test sign-in on:
#        cd ~/Documents/pakchat/server && PAKCHAT_TEST_SIGN_IN=1 mix phx.server
#   2. Two Android emulators are running (Android Studio > Device Manager > start two).
#   3. The APK is installed on both:  adb -s <each> install -r pakchat-phase4.apk
#
# Then:  bash app/maestro/two-phones.sh
#
# If a step fails, a screenshot of each phone, the app's log and Maestro's own
# record of the step are saved in ~/Desktop/pakchat-test, so we can see what
# the phones were showing at that moment.
set -euo pipefail
cd "$(dirname "$0")"

OUT="$HOME/Desktop/pakchat-test"
rm -rf "$OUT"
mkdir -p "$OUT"

# ---- Checks before starting ----

if ! curl -s --max-time 5 http://localhost:4000/api/auth/test | grep -q '"on":true'; then
  echo "The server isn't running with test sign-in on. In another Terminal window run:"
  echo "  cd ~/Documents/pakchat/server && PAKCHAT_TEST_SIGN_IN=1 mix phx.server"
  exit 1
fi

phones=($(adb devices | awk 'NR>1 && $2=="device" {print $1}'))
if [ "${#phones[@]}" -lt 2 ]; then
  echo "Start two emulators first (found ${#phones[@]})."
  exit 1
fi
A=${phones[0]}
B=${phones[1]}

for phone in "$A" "$B"; do
  if ! adb -s "$phone" shell pm list packages | grep -q com.pakchat.app; then
    echo "PakChat isn't installed on $phone. Install it first:"
    echo "  adb -s $phone install -r \"\$(ls -t ~/Downloads/pakchat-phase4*.apk | head -1)\""
    exit 1
  fi
done

# ---- Getting the phones ready ----

# Animations off while testing: on a busy Mac, screens that are still sliding
# in are what made taps and typing miss. They're switched back on at the end.
animations() {
  for phone in "$A" "$B"; do
    for s in window_animation_scale transition_animation_scale animator_duration_scale; do
      adb -s "$phone" shell settings put global "$s" "$1" || true
    done
  done
}

# Whatever happens, put the phones back as they were (network on, animations on).
step="getting ready"
finish() {
  local code=$?
  for phone in "$A" "$B"; do adb -s "$phone" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true; done
  animations 1
  if [ $code -ne 0 ]; then
    for phone in "$A" "$B"; do
      adb -s "$phone" exec-out screencap -p > "$OUT/screen-$phone.png" 2>/dev/null || true
      adb -s "$phone" logcat -d -t 400 -s ReactNativeJS:V > "$OUT/log-$phone.txt" 2>/dev/null || true
    done
    echo
    echo "Failed at: $step"
    echo "Screenshots and logs are in ~/Desktop/pakchat-test (send me the screenshots)."
  fi
}
trap finish EXIT

animations 0
for phone in "$A" "$B"; do
  # Screen on and unlocked, and the app's log emptied, so the saved log is just this run.
  adb -s "$phone" shell input keyevent KEYCODE_WAKEUP || true
  adb -s "$phone" shell wm dismiss-keyguard || true
  adb -s "$phone" logcat -c || true
done

run() {
  local phone=$1
  shift
  maestro --device "$phone" test --debug-output "$OUT/maestro" "$@"
}

# Fresh names each run, so old test chats don't get in the way.
n=$RANDOM
ALI="Ali$n"
SARA="Sara$n"

step="the app opens and really draws its sign-in screen"
echo "== $step"
for phone in "$A" "$B"; do
  run "$phone" starts.yaml
  adb -s "$phone" exec-out screencap -p > "$OUT/start-$phone.png"
  python3 looks-alive.py "$OUT/start-$phone.png"
done

step="both phones sign in"
echo "== $step"
run "$A" -e NAME="$ALI" sign-in.yaml
run "$B" -e NAME="$SARA" sign-in.yaml

step="Ali writes first, Sara answers"
echo "== $step"
run "$A" -e OTHER="$(echo "$SARA" | tr 'A-Z' 'a-z')" -e TEXT="Salam Sara" start-chat.yaml
run "$B" -e OTHER="$ALI" -e TEXT="Salam Sara" open-chat.yaml
run "$B" -e TEXT="Walaikum salam" send.yaml
run "$A" -e TEXT="Walaikum salam" wait-for.yaml

step="Sara goes offline; Ali sends three messages"
echo "== $step"
run "$B" -e MODE=true offline.yaml
run "$A" send-offline-three.yaml

step="Sara comes back and catches up, in order"
echo "== $step"
run "$B" -e MODE=false offline.yaml
run "$B" caught-up.yaml

step="looks and Urdu on Ali's phone"
echo "== $step"
run "$A" look-and-urdu.yaml

step="Ali makes a list with Sara in it, then deletes it"
echo "== $step"
run "$A" -e NAME="$SARA" lists.yaml

echo "All passed."
