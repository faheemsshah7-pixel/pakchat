defmodule PakchatWeb.BlockController do
  @moduledoc "Blocking people. The server stops passing on anything from them."
  use PakchatWeb, :controller
  alias Pakchat.Accounts
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  def index(conn, _params) do
    json(conn, %{
      blocked:
        Enum.map(Accounts.list_blocked(conn.assigns.user), &Wire.person(&1, conn.assigns.user))
    })
  end

  def create(conn, %{"user_id" => id}) do
    with %{} = them <- Accounts.get_user(id),
         :ok <- Accounts.block(conn.assigns.user, them) do
      send_resp(conn, 204, "")
    end
  end

  def delete(conn, %{"user_id" => id}) do
    with %{} = them <- Accounts.get_user(id),
         :ok <- Accounts.unblock(conn.assigns.user, them.id) do
      send_resp(conn, 204, "")
    end
  end
end
