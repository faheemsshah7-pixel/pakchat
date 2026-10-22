defmodule PakchatWeb.AuthController do
  @moduledoc """
  Signing in and out.

  `POST /api/auth/google` with:

      {"id_token": "<from Google sign-in>",
       "device": {<public keys, see PakchatWeb.Params.device/1>},
       "pre_keys": [...], "kyber_pre_keys": [...]}

  gives back `{"token": "...", "user": {...}, "device_id": 1, "device_uuid": "..."}`.
  """
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, Keys, RateLimit}
  alias Pakchat.Sms.Terminal
  alias PakchatWeb.{Params, Wire}

  action_fallback PakchatWeb.FallbackController

  def google(conn, %{"id_token" => id_token, "device" => device} = params) do
    with :ok <- RateLimit.hit(:sign_in, ip(conn)),
         {:ok, device_attrs} <- Params.device(device),
         {:ok, keys} <- Params.key_upload(params) do
      case Accounts.sign_in_with_google(id_token, device_attrs) do
        # The live connection joins "device:<device_uuid>".
        {:ok, result} ->
          signed_in(conn, result, keys)

        {:error, %Ecto.Changeset{}} = error ->
          error

        {:error, _why} ->
          # Don't say exactly what was wrong with the token.
          conn |> put_status(:unauthorized) |> json(%{error: "bad_token"})
      end
    end
  end

  def google(_conn, _params), do: {:error, :bad_request}

  @doc """
  `POST /api/auth/phone/code` with `{"phone": "0300 1234567"}` sends a 6-digit
  code (see `Pakchat.Sms`), and answers `{"phone": "+923001234567", "resend_after": 30}`.
  """
  def phone_code(conn, %{"phone" => phone}) when is_binary(phone) do
    with :ok <- RateLimit.hit(:sms, ip(conn)),
         {:ok, info} <- Accounts.send_sign_in_code(phone) do
      json(conn, info)
    end
  end

  def phone_code(_conn, _params), do: {:error, :bad_request}

  @doc """
  `POST /api/auth/phone` with `{"phone", "code", "device", "pre_keys", "kyber_pre_keys"}`.
  The same answer as Google sign-in, plus `new_account` (the app then asks for a name).
  """
  def phone(conn, %{"phone" => phone, "code" => code, "device" => device} = params)
      when is_binary(phone) and is_binary(code) do
    with :ok <- RateLimit.hit(:sign_in, ip(conn)),
         {:ok, device_attrs} <- Params.device(device),
         {:ok, keys} <- Params.key_upload(params),
         {:ok, result} <- Accounts.sign_in_with_phone(phone, code, device_attrs) do
      signed_in(conn, result, keys)
    end
  end

  def phone(_conn, _params), do: {:error, :bad_request}

  defp signed_in(conn, %{user: user, device: device, token: token} = result, keys) do
    {:ok, _} = Keys.add_pre_keys(device, keys.ec, keys.kyber)

    json(conn, %{
      token: token,
      user: Wire.me(user),
      device_id: device.device_id,
      device_uuid: device.id,
      new_account: result[:new_account] == true
    })
  end

  defp ip(conn), do: conn.remote_ip |> :inet.ntoa() |> to_string()

  @doc """
  `GET /api/auth/test/code?phone=...`: the last code printed for a number, so
  the emulator tests can sign in by phone. Only with PAKCHAT_TEST_SIGN_IN=1.
  """
  def test_code(conn, %{"phone" => phone}) do
    with :ok <- test_sign_in_on(),
         {:ok, phone} <- Pakchat.Phone.normalize(phone),
         code when is_binary(code) <- Terminal.last_code(phone) do
      json(conn, %{code: code})
    else
      _ -> {:error, :not_found}
    end
  end

  @doc """
  `POST /api/auth/test` with `{"email": "ali@test.pakchat", "name": "Ali", "device": ..., ...}`:
  a pretend account for the emulator tests. Answers 404 unless the server was
  started with PAKCHAT_TEST_SIGN_IN=1 (see Pakchat.Accounts.sign_in_for_test/3).
  `GET /api/auth/test` says whether it is switched on, so the app knows to show it.
  """
  def test(conn, %{"email" => email, "name" => name, "device" => device} = params)
      when is_binary(email) and is_binary(name) do
    with :ok <- test_sign_in_on(),
         {:ok, device_attrs} <- Params.device(device),
         {:ok, keys} <- Params.key_upload(params) do
      case Accounts.sign_in_for_test(email, String.slice(name, 0, 25), device_attrs) do
        {:ok, result} ->
          signed_in(conn, result, keys)

        {:error, %Ecto.Changeset{}} = error ->
          error

        {:error, _why} ->
          conn |> put_status(:forbidden) |> json(%{error: "not_allowed"})
      end
    end
  end

  # A sign-in with something missing, or the GET that asks "is it on?".
  def test(conn, params) do
    with :ok <- test_sign_in_on() do
      if Map.has_key?(params, "device"), do: {:error, :bad_request}, else: json(conn, %{on: true})
    end
  end

  defp test_sign_in_on do
    if Application.get_env(:pakchat, :test_sign_in, false), do: :ok, else: {:error, :not_found}
  end

  @doc "Signs this device out. Signing out the phone signs out its linked devices too."
  def sign_out(conn, _params) do
    :ok = Accounts.sign_out(conn.assigns.device)
    send_resp(conn, 204, "")
  end
end
