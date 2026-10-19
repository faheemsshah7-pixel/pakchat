# Phase 0: set up your MacBook Air

Do these in Terminal, in order. (This is for your **MacBook Air** only.)

1. Go to your project:
   `cd ~/Documents/pakchat`
2. Run the setup script. It installs Elixir and Postgres, and makes `server/` and `app/`:
   `bash scripts/setup-phase0.sh`
   (If Homebrew is missing it tells you. Install it from https://brew.sh, then run the script again.)
3. Check the server:
   `cd server && mix phx.server`
   Wait for "Running PakchatWeb.Endpoint". Open http://localhost:4000.
   A page saying "no route found" is **correct** (the server has no web pages yet).
   Press `Ctrl+C` twice to stop.
4. Check the app:
   `cd ../app && npx expo start`
   A QR code appears. To see it on your phone, install **Expo Go** and scan the QR.
   Press `Ctrl+C` to stop.

If a step shows a red error, copy the last few lines and send them to me.
