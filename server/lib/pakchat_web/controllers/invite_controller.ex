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
        members: length(chat.members),
        kind: chat.kind,
        call_link: chat.call_link,
        approval: chat.join_approval
      })
    end
  end

  def join(conn, %{"code" => code}) do
    me = conn.assigns.user

    with :ok <- RateLimit.hit(:invites, me.id) do
      case Chats.join_by_invite(me, code) do
        # Its admins approve who joins: they've been asked.
        {:ok, :requested} -> conn |> put_status(202) |> json(%{requested: true})
        {:ok, chat} -> json(conn, Wire.chat(chat, me.id))
        error -> error
      end
    end
  end
end
