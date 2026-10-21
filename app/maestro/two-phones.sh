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
set -euo pipefail
cd "$(dirname "$0")"

phones=($(adb devices | awk 'NR>1 && $2=="device" {print $1}'))
if [ "${#phones[@]}" -lt 2 ]; then
  echo "Start two emulators first (found ${#phones[@]})."
  exit 1
fi
A=${phones[0]}
B=${phones[1]}
run() { local phone=$1; shift; maestro --device "$phone" test "$@"; }
# Fresh names each run, so old test chats don't get in the way.
n=$RANDOM
ALI="Ali$n"
SARA="Sara$n"

echo "== Both phones sign in"
run "$A" -e NAME="$ALI" sign-in.yaml
run "$B" -e NAME="$SARA" sign-in.yaml

echo "== Ali writes first, Sara answers"
run "$A" -e OTHER="$(echo "$SARA" | tr 'A-Z' 'a-z')" -e TEXT="Salam Sara" start-chat.yaml
run "$B" -e OTHER="$ALI" -e TEXT="Salam Sara" open-chat.yaml
run "$B" -e TEXT="Walaikum salam" send.yaml
run "$A" -e TEXT="Walaikum salam" wait-for.yaml

echo "== Sara goes offline; Ali sends three messages"
run "$B" -e MODE=true offline.yaml
run "$A" send-offline-three.yaml

echo "== Sara comes back and catches up, in order"
run "$B" -e MODE=false offline.yaml
run "$B" caught-up.yaml

echo "== Looks and Urdu on Ali's phone"
run "$A" look-and-urdu.yaml

echo "All passed."
