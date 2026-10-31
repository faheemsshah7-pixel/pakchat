defmodule PakchatWeb.ReceiptController do
  @moduledoc """
  Ticks sent without the live connection. A phone woken by a push opens the
  messages that came inside it straight away, and says "delivered" here at
  once, so the sender sees two ticks as the alert shows (like WhatsApp), not
  only after the phone has connected. The same as the live connection's
  `"receipt"` (see `PakchatWeb.DeviceChannel`).
  """
  use PakchatWeb, :controller
  alias Pakchat.Relay

  action_fallback PakchatWeb.FallbackController

  @doc "`POST /api/receipts` with `{chat_id, to, status: \"delivered\" | \"read\", seqs}`."
  def create(conn, %{"chat_id" => chat_id, "to" => to} = p)
      when is_binary(chat_id) and is_binary(to) do
    with :ok <- Relay.send_receipt(conn.assigns.device, chat_id, to, p["status"], p["seqs"]) do
      json(conn, %{ok: true})
    end
  end

  def create(_conn, _params), do: {:error, :bad_request}
end
