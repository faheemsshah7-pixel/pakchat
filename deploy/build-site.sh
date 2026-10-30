#!/bin/sh
# build-site.sh: builds the website for our address into deploy/site, with the APK
# next to it (when there is one). Run on the server from deploy/, after git pull:
#   ./build-site.sh                      the website only
#   ./build-site.sh ~/pakchat.apk 9 1.0.9   and a new APK: its file, build number and version
# The APK's build number tells phones with the website's APK that there's an update (UpdateCard.tsx).
set -eu
cd "$(dirname "$0")"
. ./.env
[ -n "${PAKCHAT_DOMAIN:-}" ] || { echo "Put PAKCHAT_DOMAIN in deploy/.env first"; exit 1; }

# Built in a throwaway Node container, so the server needs no Node of its own.
docker run --rm -v "$PWD/../web:/web" -v "$PWD/../shared:/shared" -w /web \
  -e VITE_SERVER_URL="https://$PAKCHAT_DOMAIN" node:22-bookworm-slim \
  sh -c "cd /shared && npm ci --no-audit --no-fund && cd /web && npm ci --no-audit --no-fund && npx vite build"

mkdir -p site.new
cp -R ../web/dist/. site.new/
# Keep the APK already being served unless a new one is given.
if [ -f site/pakchat.apk ]; then cp site/pakchat.apk site/pakchat-apk.json site.new/ 2>/dev/null || true; fi
if [ $# -ge 3 ]; then
  cp "$1" site.new/pakchat.apk
  printf '{ "versionCode": %s, "versionName": "%s" }\n' "$2" "$3" > site.new/pakchat-apk.json
fi
# Swapped in place, file by file (Caddy serves this very folder, so it isn't replaced).
mkdir -p site
rsync -a --delete-after site.new/ site/
rm -rf site.new
echo "Website ready in deploy/site (served at once, no restart needed)."
