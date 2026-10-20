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

## What you get right now

| Address | What it is |
| --- | --- |
| http://localhost:4000 | A plain page saying the server is up |
| http://localhost:4000/api/health | `{"status":"ok","database":"ok"}` for the host to check |
| http://localhost:4000/dev/dashboard | Live memory, processes and requests (dev only) |

## The files, in plain words

```
mix.exs                       the library list and the shortcut commands
config/
  config.exs                  settings for every mode
  dev.exs                     settings while you develop (database, port 4000)
  test.exs                    settings while tests run
  runtime.exs                 settings read when the real server boots
lib/pakchat/
  application.ex              the list of things that start up, in order
  repo.ex                     the door to Postgres
lib/pakchat_web/
  endpoint.ex                 the front door: every request comes through here
  router.ex                   which address goes to which bit of code
  controllers/                code that answers a request
  components/                 the handful of pages the server shows itself
priv/repo/migrations/         the step-by-step history of the database shape
test/                         the tests
```

Nothing above is special to PakChat yet. It is the standard Phoenix skeleton with
the pieces we will not need taken out, plus the health check.

## Words you will keep seeing

- **Mix** is Elixir's version of npm plus the scripts section. `mix something`.
- **Hex** is Elixir's npm registry. Libraries are listed in `mix.exs`.
- **Ecto** is how Elixir talks to Postgres. `Pakchat.Repo` is the connection.
- **A migration** is one change to the database shape, saved as a file so every
  machine ends up with the same tables.
- **A controller** answers one request and then it is gone.
- **A channel** keeps a connection open, so the server can push at any moment.
  That is what phase 2 is built on, and there are none yet.
- **A supervisor** restarts anything that crashes. `application.ex` sets that up,
  which is why an Elixir server survives small failures.

## Next

Phase 2 in `PAKCHAT-SPEC.md` turns this into the real relay: accounts, devices,
the waiting-message table, and the channels the app connects to.
