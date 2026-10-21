defmodule PakchatWeb.InviteController do
  @moduledoc "Opening and using a group's invite link."
  use PakchatWeb, :controller
  alias Pakchat.{Chats, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  @doc ~s(`GET /api/invites/:code`: the group's name and size, for the "Join group?" screen.)
  def show(conn, %{"code" => code}) do
    with :ok <- RateLimit.hit(:invites, conn.assigns.user.id),
         {:ok, chat} <- Chats.get_by_invite(code) do
      json(conn, %{
        chat_id: chat.id,
        title: chat.title,
        photo: chat.photo,
        description: chat.description,
        members: length(chat.members)
      })
    end
  end

  def join(conn, %{"code" => code}) do
    me = conn.assigns.user

    with :ok <- RateLimit.hit(:invites, me.id),
         {:ok, chat} <- Chats.join_by_invite(me, code) do
      json(conn, Wire.chat(chat, me.id))
    end
  end
end
