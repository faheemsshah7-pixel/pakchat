#!/usr/bin/env bash
# PakChat phase 0 setup. Run it from the pakchat folder on your MacBook Air:
#   bash scripts/setup-phase0.sh
# It is safe to run again: every step skips what is already done.
set -e

# Make sure we are in the repo root (the folder that holds web/ and scripts/).
cd "$(dirname "$0")/.."
if [ ! -d web ]; then
  echo "Stop: I can't see the web/ folder. Run this inside ~/Documents/pakchat"; exit 1
fi

echo "==> 1/6 Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is missing. Install it from https://brew.sh first, then run this again."; exit 1
fi

echo "==> 2/6 Elixir and Postgres (installed with Homebrew)"
brew list elixir >/dev/null 2>&1 || brew install elixir
brew list postgresql@17 >/dev/null 2>&1 || brew install postgresql@17
brew services start postgresql@17 >/dev/null
PGBIN="$(brew --prefix postgresql@17)/bin"
export PATH="$PGBIN:$PATH"
# Give Postgres a few seconds to start.
for i in 1 2 3 4 5 6 7 8 9 10; do pg_isready -q && break; sleep 1; done
# Phoenix's dev settings expect a database user "postgres" with password "postgres".
# This is a LOCAL practice database on your Mac only, so a simple password is fine.
psql -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='postgres'" | grep -q 1 \
  || createuser -s postgres
psql -d postgres -c "ALTER USER postgres PASSWORD 'postgres'" >/dev/null

echo "==> 3/6 Phoenix tools"
mix local.hex --force
mix local.rebar --force
mix archive.install hex phx_new --force

echo "==> 4/6 server/ (the Phoenix app)"
if [ ! -f server/mix.exs ]; then
  rm -f server/README.md   # the placeholder; Phoenix writes its own
  # API only: no web pages, no assets, no mailer. Just the relay we need.
  mix phx.new server --app pakchat --no-html --no-assets --no-mailer --no-gettext --no-dashboard --install
fi
(cd server && mix ecto.create)

echo "==> 5/6 app/ (the Expo phone app)"
if [ ! -f app/package.json ]; then
  rm -f app/README.md      # the placeholder; Expo writes its own
  npx --yes create-expo-app@latest app --template blank-typescript --no-install
fi
(cd app && npm install)

echo "==> 6/6 shared/ and notes"
npm install   # links the shared/ package
# Keep secrets and build folders out of git (adds lines only if missing).
touch .gitignore
for line in "node_modules/" ".DS_Store" "server/.env" "web/.env.local" "server/_build/" "server/deps/" "app/.expo/"; do
  grep -qxF "$line" .gitignore || echo "$line" >> .gitignore
done
# Add this phase's step to LEARN.md (once).
if [ -f learn-phase0.md ]; then
  grep -q "Step 23" LEARN.md 2>/dev/null || cat learn-phase0.md >> LEARN.md
  rm -f learn-phase0.md
fi

echo ""
echo "Done. Now check the two things:"
echo "  Server:  cd server && mix phx.server     (open http://localhost:4000, then Ctrl+C)"
echo "  App:     cd app && npx expo start        (press Ctrl+C to stop)"
