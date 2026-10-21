# server — the PakChat relay

Elixir and Phoenix. This is the only part that runs in the cloud, and it does as
little as possible on purpose: it passes along messages it cannot read, and
deletes them once they arrive.

## Run it

```
mix setup        # gets the libraries and creates the database (first time only)
mix phx.server   # starts it on http://localhost:4000
```

Postgres has to be running first, and it needs a user called `postgres`.
Homebrew makes one named after you instead, so create it once:

```
brew services start postgresql@17
pg_isready            # should say "accepting connections"
createuser -s postgres   # once; harmless if it already exists
```

If you would rather use your own Postgres user, set `PGUSER` (and `PGPASSWORD`
if you have one) before running mix, and the config picks it up.

Stop the server with Ctrl+C twice.

## Settings on your Mac

Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_IDS` (from Google Cloud,
APIs & Services, Credentials). Git ignores `.env`, so it never leaves your Mac.
Without it the server runs fine, but nobody can sign in.

## Test it

```
mix test            # all the tests (57 of them)
mix credo           # style checks
mix format          # tidies the code
```

The shared core (`../shared`) also has tests that use this server for real.
Start a test copy with its own empty database, then run them from `shared`:

```
MIX_ENV=test mix run --no-start test/e2e_server.exs   # port 4002, plus a helper on 4003
cd ../shared && npm run test:server                   # in a second terminal
```

## What the server does

| Address | What it is |
| --- | --- |
| `GET /api/health` | `{"status":"ok","database":"ok"}` for the host to check |
| `POST /api/auth/google` | Sign in with a Google token and the phone's public keys. Gives a session token |
| `DELETE /api/auth/session` | Sign out (the phone signs out its linked devices too) |
| `GET`/`PATCH /api/me` | My profile and privacy settings |
| `PUT /api/me/push` | My push token, for alerts when the app is closed |
| `GET`/`POST /api/keys` | How many one-time keys I have left / upload more |
| `GET /api/users/lookup?email=` | Find someone by Gmail (rate-limited) |
| `GET /api/users/:id` | Someone's name, about and photo |
| `GET /api/users/:id/presence` | Their online and last seen, as their privacy allows |
| `GET /api/users/:id/devices` | Their device numbers |
| `POST /api/users/:id/bundles` | Their key bundles, to start a locked chat (rate-limited) |
| `GET /api/chats`, `GET /api/chats/:id` | My chats, with members and each chat's counter |
| `POST /api/chats/direct` | Open the chat with someone |
| `POST /api/groups`, `PATCH /api/groups/:id` | Make or change a group (admins only) |
| `POST`/`DELETE /api/groups/:id/members/...` | Add people, remove people, or leave |
| `PUT`/`DELETE /api/groups/:id/admins/:user_id` | Make or unmake an admin |
| `POST`/`DELETE /api/groups/:id/invite` | A new invite link, or none |
| `GET /api/invites/:code`, `POST /api/invites/:code/join` | See and join a group from a link |
| `GET /api/blocks`, `PUT`/`DELETE /api/blocks/:user_id` | Block and unblock |
| `ws://…/socket/websocket?token=…` | The live connection. Join `device:<your device id>` |
| `/dev/dashboard` | Live memory, processes and requests (dev only) |

Everything except health and sign-in needs `Authorization: Bearer <token>`.
Sign-in gives back `device_uuid` too: that's the id in `device:<your device id>`.

Sending on the live connection (`"send"`) takes a `kind`:
- `message` and `reaction`: a normal send. A group send can list the devices it
  thinks are in the group (`devices`), and gets `stale_devices` back if that
  list is out of date.
- `control`: "please send that again", or the resend itself. It goes only to
  the devices named, and isn't held back by "only admins can send".

## The files, in plain words

```
mix.exs                       the library list and the shortcut commands
config/                       settings (rate limits and background jobs are in config.exs)
lib/pakchat/
  accounts.ex                 signing in, devices, profiles, blocking
  accounts/google_token.ex    checks Google's sign-in tokens
  keys.ex                     Signal public keys and one-time keys
  chats.ex                    one-to-one chats, groups, admins, invite links
  relay.ex                    sending, holding, delivering and deleting envelopes
  privacy.ex                  who may see online and last seen
  presence.ex                 who is online right now
  push.ex, push/notify.ex     push alerts (a stub until phase 5)
  relay/cleanup.ex            the hourly job that deletes 30-day-old envelopes
  rate_limit.ex               "too many, slow down"
lib/pakchat_web/
  router.ex                   which address goes to which controller
  controllers/                one file per group of addresses above
  channels/device_socket.ex   the live connection: checks the token
  channels/device_channel.ex  everything live: send, ack, ticks, typing, online
  wire.ex, params.ex          the JSON shapes going out and coming in
  plugs/auth.ex, plugs/cors.ex  the session token check, and which websites may call
priv/repo/migrations/         the tables
test/                         the tests
```

## Words you will keep seeing

- **Mix** is Elixir's version of npm plus the scripts section. `mix something`.
- **Ecto** is how Elixir talks to Postgres. `Pakchat.Repo` is the connection.
- **A migration** is one change to the database shape, saved as a file.
- **A controller** answers one request and then it is gone.
- **A channel** keeps a connection open, so the server can push at any moment.
- **An envelope** is one locked message for one device. The server can't open it.
- **Oban** runs background jobs (push alerts, clean-up) from a table in Postgres.
- **A supervisor** restarts anything that crashes. `application.ex` sets that up.

See steps 24 and 25 in `LEARN.md` for how it all fits together.
