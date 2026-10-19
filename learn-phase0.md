
## Step 23: Phase 0, the new tools

**What we added:** three new folders next to `web/`: `server/`, `shared/` and `app/`.

**The tools**
- **Elixir** is a programming language that is very good at keeping many connections open at once.
  A chat server needs exactly that.
- **Phoenix** is the toolkit (framework) built on Elixir. It handles the always-open connections
  ("channels") between phones and the server.
- **Postgres** is the database. It remembers accounts, groups and messages that are waiting to be
  delivered.
- **React Native (with Expo)** builds a real phone app using the same React you already know from
  `web/`. Expo is the helper that makes it easy to run and test.
- **npm workspaces** let folders like `shared/` be used by more than one project.

**The files**
- `package.json` (top): says "shared/ belongs to this project".
- `shared/`: code the phone app and website will both use later.
- `server/`: the Phoenix app. `app/`: the Expo app.
- `scripts/setup-phase0.sh`: installs the tools and creates `server/` and `app/`.

**How it works:** the phone app talks to the Phoenix server, and Phoenix saves what it needs in
Postgres. Your website at `web/` is not touched and stays live.

**Try this**
1. Run `cd server && mix phx.server`, then open http://localhost:4000. Seeing "no route found"
   means the server is alive.
2. Run `cd app && npx expo start` and look at the QR code.
3. Open `shared/src/index.ts` and read the `hello` function.
