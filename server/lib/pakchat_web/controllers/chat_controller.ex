defmodule PakchatWeb.ChatController do
  @moduledoc "My chats, and opening a chat with one person."
  use PakchatWeb, :controller
  alias Pakchat.Chats
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  def index(conn, _params) do
    me = conn.assigns.user
    json(conn, %{chats: Enum.map(Chats.list_chats(me), &Wire.chat(&1, me.id))})
  end

  def show(conn, %{"id" => id}) do
    me = conn.assigns.user
    with {:ok, chat} <- Chats.get_chat(me, id), do: json(conn, Wire.chat(chat, me.id))
  end

  @doc "`POST /api/chats/direct` with `{user_id}`. Gives the same chat every time."
  def direct(conn, %{"user_id" => user_id}) do
    me = conn.assigns.user

    with {:ok, chat} <- Chats.get_or_create_direct(me, user_id) do
      json(conn, Wire.chat(chat, me.id))
    end
  end

  def direct(_conn, _params), do: {:error, :bad_request}
end
