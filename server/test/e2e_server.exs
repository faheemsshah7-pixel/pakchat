# Starts a real server for the shared core's end-to-end tests
# (shared/test/e2e). It runs in test mode, on its own test database, and
# signs pretend Google tokens, so it can never touch real accounts.
#
#   cd server
#   MIX_ENV=test mix run --no-start test/e2e_server.exs
#
# Then, in another terminal: cd shared && npm run test:server
# Stop it with Ctrl+C twice.
#
# Port 4002 is the normal server. Port 4003 is a small helper only these
# tests use: it makes pretend Google tokens, and links a website to a phone
# (the real QR code linking comes in phase 8).

defmodule Pakchat.E2EHelper do
  @moduledoc false
  use Plug.Router
  alias Pakchat.{Accounts, Keys}
  alias PakchatWeb.Params

  plug Plug.Parsers, parsers: [:json], json_decoder: Jason
  plug :match
  plug :dispatch

  # `{name, key}` -> a pretend Google token. The same `key` is the same
  # Google account (to sign in again, as after reinstalling).
  post "/google_token" do
    name = conn.body_params["name"] || "Test"
    key = conn.body_params["key"] || "#{System.unique_integer([:positive])}"

    token =
      Pakchat.GoogleFake.token(%{
        "sub" => "google-#{key}",
        "email" => "e2e-#{key}@gmail.com",
        "name" => name
      })

    reply(conn, %{id_token: token})
  end

  # `{token, device, pre_keys, kyber_pre_keys}` -> a new linked device for
  # whoever owns `token`, like scanning the QR code with the phone.
  post "/link" do
    p = conn.body_params

    with %{} = phone <- Accounts.device_by_token(p["token"]),
         {:ok, attrs} <- Params.device(p["device"]),
         {:ok, keys} <- Params.key_upload(p),
         {:ok, %{device: device, token: token}} <- Accounts.add_linked_device(phone.user, attrs),
         {:ok, _} <- Keys.add_pre_keys(device, keys.ec, keys.kyber) do
      reply(conn, %{token: token, device_id: device.device_id, device_uuid: device.id})
    else
      error -> reply(conn, %{error: inspect(error)}, 400)
    end
  end

  match _ do
    send_resp(conn, 404, "")
  end

  defp reply(conn, body, status \\ 200) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
  end
end

if Mix.env() != :test, do: raise("Run this with MIX_ENV=test only.")

# Turn the web server on (tests normally don't), and loosen the limits: the
# tests sign in and send a lot, quickly, from one computer.
endpoint = Application.get_env(:pakchat, PakchatWeb.Endpoint)

Application.put_env(
  :pakchat,
  PakchatWeb.Endpoint,
  Keyword.merge(endpoint, server: true, http: [ip: {127, 0, 0, 1}, port: 4002])
)

Application.put_env(:pakchat, :rate_limits,
  sign_in: {100_000, 60_000},
  lookup: {100_000, 60_000},
  keys: {100_000, 60_000},
  send: {100_000, 10_000},
  groups: {100_000, 60_000},
  invites: {100_000, 60_000}
)

# Its own database (so `mix test` can still run alongside), fresh each time.
repo = Application.get_env(:pakchat, Pakchat.Repo)
# A normal connection pool, not the tests' one-at-a-time sandbox.
Application.put_env(
  :pakchat,
  Pakchat.Repo,
  Keyword.merge(repo, database: "pakchat_e2e", pool: DBConnection.ConnectionPool, pool_size: 10)
)

Mix.Task.run("ecto.drop", ["--quiet"])
Mix.Task.run("ecto.create", ["--quiet"])
Mix.Task.run("ecto.migrate", ["--quiet"])
{:ok, _} = Application.ensure_all_started(:pakchat)

{:ok, _} = Bandit.start_link(plug: Pakchat.E2EHelper, ip: {127, 0, 0, 1}, port: 4003)
IO.puts("PakChat test server: http://localhost:4002 (helper on 4003). Ctrl+C twice to stop.")
Process.sleep(:infinity)
