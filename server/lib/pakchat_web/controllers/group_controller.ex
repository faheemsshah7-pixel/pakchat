defmodule PakchatWeb.GroupController do
  @moduledoc """
  Groups: making them, changing them, people, admins and invite links.
  Only admins can change a group. Anyone can leave.
  """
  use PakchatWeb, :controller
  alias Pakchat.{Chats, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  @fields ["title", "description", "photo", "only_admins_send"]

  @doc "`POST /api/groups` with `{title, member_ids, description?}`."
  def create(conn, params) do
    me = conn.assigns.user

    with :ok <- RateLimit.hit(:groups, me.id),
         {:ok, chat} <- Chats.create_group(me, Map.take(params, @fields), params["member_ids"]) do
      conn |> put_status(201) |> json(Wire.chat(chat, me.id))
    end
  end

  def update(conn, %{"id" => id} = params) do
    me = conn.assigns.user

    with {:ok, chat} <- Chats.update_group(me, id, Map.take(params, @fields)) do
      json(conn, Wire.chat(chat, me.id))
    end
  end

  @doc "`POST /api/groups/:id/members` with `{user_ids}`."
  def add_members(conn, %{"id" => id, "user_ids" => user_ids}) when is_list(user_ids) do
    me = conn.assigns.user

    with {:ok, chat} <- Chats.add_members(me, id, user_ids),
         do: json(conn, Wire.chat(chat, me.id))
  end

  def add_members(_conn, _params), do: {:error, :bad_request}

  @doc "`DELETE /api/groups/:id/members/:user_id`. Your own id means: leave."
  def remove_member(conn, %{"id" => id, "user_id" => user_id}) do
    with {:ok, _} <- Chats.remove_member(conn.assigns.user, id, user_id) do
      send_resp(conn, 204, "")
    end
  end

  def make_admin(conn, params), do: set_admin(conn, params, true)
  def remove_admin(conn, params), do: set_admin(conn, params, false)

  defp set_admin(conn, %{"id" => id, "user_id" => user_id}, admin?) do
    me = conn.assigns.user

    with {:ok, chat} <- Chats.set_admin(me, id, user_id, admin?) do
      json(conn, Wire.chat(chat, me.id))
    end
  end

  @doc "`POST /api/groups/:id/invite`: a new link (the old one stops working)."
  def reset_invite(conn, %{"id" => id}) do
    with {:ok, code} <- Chats.reset_invite(conn.assigns.user, id), do: json(conn, %{code: code})
  end

  def remove_invite(conn, %{"id" => id}) do
    with :ok <- Chats.remove_invite(conn.assigns.user, id), do: send_resp(conn, 204, "")
  end
end
