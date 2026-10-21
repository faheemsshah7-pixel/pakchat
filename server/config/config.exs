# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :pakchat,
  ecto_repos: [Pakchat.Repo],
  generators: [timestamp_type: :utc_datetime]

# Background jobs (Oban). "push" sends alerts; Cron runs the hourly clean-up
# that deletes envelopes nobody collected in 30 days.
config :pakchat, Oban,
  engine: Oban.Engines.Basic,
  repo: Pakchat.Repo,
  queues: [default: 10, push: 20],
  plugins: [
    {Oban.Plugins.Pruner, max_age: 86_400},
    {Oban.Plugins.Cron, crontab: [{"@hourly", Pakchat.Relay.Cleanup}]}
  ]

# Rate limits: {how many, per how many milliseconds}.
config :pakchat, :rate_limits,
  # Sign-ins, per internet address.
  sign_in: {10, 60_000},
  # Finding people by Gmail, per person.
  lookup: {30, 60_000},
  # Taking someone's keys to start a chat, per person.
  keys: {60, 60_000},
  # Sending messages, per device.
  send: {100, 10_000},
  # Making groups, per person.
  groups: {20, 60_000},
  # Looking up and using invite links, per person.
  invites: {20, 60_000}

# Websites allowed to talk to the server (the phone app doesn't need this).
config :pakchat, :allowed_origins, [
  "https://pakchat-f89d8.web.app",
  "https://pakchat-f89d8.firebaseapp.com"
]

# Configure the endpoint
config :pakchat, PakchatWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [html: PakchatWeb.ErrorHTML, json: PakchatWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Pakchat.PubSub,
  live_view: [signing_salt: "lPUY3dBU"]

# Configure LiveView
config :phoenix_live_view,
  # the attribute set on all root tags. Used for Phoenix.LiveView.ColocatedCSS.
  root_tag_attribute: "phx-r"

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
