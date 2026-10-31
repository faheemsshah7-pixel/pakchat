import Config

# Configure your database.
#
# Homebrew's Postgres makes a user named after you, not "postgres". So we read
# the name from PGUSER if it is set, and fall back to "postgres".
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :pakchat, Pakchat.Repo,
  username: System.get_env("PGUSER", "postgres"),
  password: System.get_env("PGPASSWORD", "postgres"),
  hostname: "localhost",
  database: "pakchat_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :pakchat, PakchatWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "pbmhvQFv1V5LWH5iQyaLZjtAPPEUMcggM7cTsBZlxe/NJFj2/bmmFJ/oS9gMAvPV",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Enable helpful, but potentially expensive runtime checks
config :phoenix_live_view,
  enable_expensive_runtime_checks: true

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true

# Background jobs don't run by themselves in tests; tests check they were queued.
config :pakchat, Oban, testing: :manual

# Tests sign their own pretend Google tokens (see test/support/google_fake.ex).
config :pakchat, :google_keys, Pakchat.GoogleFake
config :pakchat, :google_client_ids, ["pakchat-test.apps.googleusercontent.com"]
config :pakchat, :allowed_origins, ["http://localhost:5173"]

# Every test signs in from the same address, so allow more sign-ins here.
config :pakchat, :rate_limits,
  sign_in: {1000, 60_000},
  sms: {1000, 60_000},
  whatsapp: {1000, 60_000},
  whatsapp_claim: {1000, 60_000},
  link: {1000, 60_000}

# Files from the tests go in a folder of their own.
config :pakchat, :files_dir, Path.join(System.tmp_dir!(), "pakchat-test-files")
config :pakchat, :file_max_mb, 1
