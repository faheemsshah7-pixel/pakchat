defmodule PakchatWeb.AuthController do
  @moduledoc """
  Signing in and out.

  `POST /api/auth/google` with:

      {"id_token": "<from Google sign-in>",
       "device": {<public keys, see PakchatWeb.Params.device/1>},
       "pre_keys": [...], "kyber_pre_keys": [...]}

  gives back `{"token": "...", "user": {...}, "device_id": 1}`.
  """
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, Keys, RateLimit}
  alias PakchatWeb.{Params, Wire}

  action_fallback PakchatWeb.FallbackController

  def google(conn, %{"id_token" => id_token, "device" => device} = params) do
    ip = conn.remote_ip |> :inet.ntoa() |> to_string()

    with :ok <- RateLimit.hit(:sign_in, ip),
         {:ok, device_attrs} <- Params.device(device),
         {:ok, keys} <- Params.key_upload(params) do
      case Accounts.sign_in_with_google(id_token, device_attrs) do
        {:ok, %{user: user, device: device, token: token}} ->
          {:ok, _} = Keys.add_pre_keys(device, keys.ec, keys.kyber)
          json(conn, %{token: token, user: Wire.me(user), device_id: device.device_id})

        {:error, %Ecto.Changeset{}} = error ->
          error

        {:error, _why} ->
          # Don't say exactly what was wrong with the token.
          conn |> put_status(:unauthorized) |> json(%{error: "bad_token"})
      end
    end
  end

  def google(_conn, _params), do: {:error, :bad_request}

  @doc "Signs this device out. Signing out the phone signs out its linked devices too."
  def sign_out(conn, _params) do
    :ok = Accounts.sign_out(conn.assigns.device)
    send_resp(conn, 204, "")
  end
end
