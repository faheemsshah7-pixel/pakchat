defmodule PakchatWeb.UserController do
  @moduledoc "Finding people, their profiles, and whether they're online."
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, Privacy, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  @doc "`GET /api/users/lookup?email=sara@gmail.com`. Limited, so nobody can try thousands."
  def lookup(conn, params) do
    with :ok <- RateLimit.hit(:lookup, conn.assigns.user.id),
         %{} = user <- Accounts.find_by_email(params["email"]) do
      json(conn, Wire.person(user))
    end
  end

  def show(conn, %{"id" => id}) do
    with %{} = user <- Accounts.get_user(id) do
      json(conn, Wire.person(user))
    end
  end

  @doc "Online and last seen, as far as their privacy settings let me see."
  def presence(conn, %{"id" => id}) do
    with %{} = user <- Accounts.get_user(id) do
      json(conn, Privacy.presence_for(conn.assigns.user, user))
    end
  end
end
