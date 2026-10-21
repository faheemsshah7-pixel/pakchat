defmodule PakchatWeb.HealthController do
  @moduledoc """
  A tiny "are you alive?" endpoint.

  Hosting services ping a URL like this every few seconds. If it stops
  answering, they restart the server. It also checks the database, so a
  server that cannot reach Postgres reports itself as unhealthy.
  """
  use PakchatWeb, :controller
  alias Ecto.Adapters.SQL

  def show(conn, _params) do
    case SQL.query(Pakchat.Repo, "SELECT 1", []) do
      {:ok, _} -> json(conn, %{status: "ok", database: "ok"})
      {:error, _} -> conn |> put_status(503) |> json(%{status: "error", database: "down"})
    end
  end
end
