defmodule PakchatWeb.WhatsAppController do
  @moduledoc """
  Checking a phone number with WhatsApp (see Pakchat.WhatsApp).

  For the app:

    * `GET /api/auth/whatsapp`: `{"on": true}` when it's switched on (404 when not).
    * `POST /api/auth/whatsapp` with `{"purpose": "sign_in" | "link"}`: starts a check,
      `{"id", "secret", "code", "text", "url", "expires_in"}`. The app opens `url`.
    * `POST /api/auth/whatsapp/:id` with `{"secret"}`: `{"status": "waiting"}`, or
      `{"status": "done", "phone": "+92..."}`. The secret is then the code for
      `POST /api/auth/phone` (signing in) or `PUT /api/me/phone` (adding the number).

  For Meta: `GET` and `POST /api/whatsapp/webhook`.
  """
  use PakchatWeb, :controller
  require Logger
  alias Pakchat.{RateLimit, WhatsApp}

  action_fallback PakchatWeb.FallbackController

  def show(conn, _params) do
    if WhatsApp.on?(), do: json(conn, %{on: true}), else: {:error, :not_found}
  end

  def start(conn, params) do
    with :ok <- RateLimit.hit(:whatsapp, ip(conn)),
         {:ok, check} <- WhatsApp.start(params["purpose"] || "sign_in") do
      json(conn, check)
    end
  end

  def claim(conn, %{"id" => id, "secret" => secret}) when is_binary(secret) do
    with :ok <- RateLimit.hit(:whatsapp_claim, id) do
      case WhatsApp.claim(id, secret) do
        {:ok, :waiting} -> json(conn, %{status: "waiting"})
        {:ok, phone} -> json(conn, %{status: "done", phone: phone})
        error -> error
      end
    end
  end

  def claim(_conn, _params), do: {:error, :bad_request}

  @doc "Meta checking our webhook address once, when it's typed into Meta's page."
  def verify(conn, params) do
    if params["hub.mode"] == "subscribe" and WhatsApp.verify_token?(params["hub.verify_token"]) do
      conn
      |> put_resp_content_type("text/plain")
      |> send_resp(200, to_string(params["hub.challenge"]))
    else
      send_resp(conn, 403, "")
    end
  end

  @doc "A message (or a delivery report) for PakChat's WhatsApp number, from Meta."
  def webhook(conn, params) do
    raw = conn.assigns[:raw_body] || ""

    if WhatsApp.signed?(raw, List.first(get_req_header(conn, "x-hub-signature-256"))) do
      WhatsApp.handle_webhook(params)
      # Always "got it", or Meta keeps sending the same message again.
      send_resp(conn, 200, "")
    else
      Logger.warning("whatsapp: a webhook call without Meta's signature")
      send_resp(conn, 401, "")
    end
  end

  defp ip(conn), do: conn.remote_ip |> :inet.ntoa() |> to_string()
end
