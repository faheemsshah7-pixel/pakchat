defmodule PakchatWeb.StatusController do
  @moduledoc """
  Who sees my status. `PUT /api/status/audience` with `{"user_ids": [...]}`
  answers my status chat (see `Pakchat.Chats.set_status_audience/2`). The
  phone works out the list from my privacy choice ("My contacts", "My
  contacts except…", "Only share with…") and sends it whenever that changes.
  """
  use PakchatWeb, :controller
  alias Pakchat.{Chats, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  def audience(conn, %{"user_ids" => ids}) when is_list(ids) do
    me = conn.assigns.user

    with :ok <- RateLimit.hit(:status, me.id),
         true <- Enum.all?(ids, &is_binary/1) || {:error, :bad_request},
         {:ok, chat} <- Chats.set_status_audience(me, ids) do
      json(conn, Wire.chat(chat, me.id))
    end
  end

  def audience(_conn, _params), do: {:error, :bad_request}
end
