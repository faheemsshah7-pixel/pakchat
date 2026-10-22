defmodule PakchatWeb.MeController do
  @moduledoc "My own profile and privacy settings, and my push token."
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  def show(conn, _params), do: json(conn, Wire.me(conn.assigns.user))

  @doc """
  `PATCH /api/me` with any of: name, about, photo, and
  `privacy: {last_seen: "everyone" | "contacts" | "nobody",
  online: "everyone" | "same", read_receipts: true | false}`.
  """
  def update(conn, params) do
    privacy = if is_map(params["privacy"]), do: params["privacy"], else: %{}

    attrs =
      params
      |> Map.take(["name", "about", "photo"])
      |> put_if(privacy, "last_seen", "last_seen_visibility")
      |> put_if(privacy, "online", "online_visibility")
      |> put_if(privacy, "read_receipts", "read_receipts")

    with {:ok, user} <- Accounts.update_profile(conn.assigns.user, attrs) do
      json(conn, Wire.me(user))
    end
  end

  defp put_if(attrs, from, key, as) do
    if Map.has_key?(from, key), do: Map.put(attrs, as, from[key]), else: attrs
  end

  @doc "`PUT /api/me/google` with `{id_token}`: adds a Gmail to my account (I signed in by phone)."
  def link_google(conn, %{"id_token" => id_token}) when is_binary(id_token) do
    with {:ok, user} <- Accounts.link_google(conn.assigns.user, id_token) do
      json(conn, Wire.me(user))
    end
  end

  def link_google(_conn, _params), do: {:error, :bad_request}

  @doc "`POST /api/me/phone/code` with `{phone}`: sends a code to a number I want to add."
  def phone_code(conn, %{"phone" => phone}) when is_binary(phone) do
    with :ok <- RateLimit.hit(:sms, conn.assigns.user.id),
         {:ok, info} <- Accounts.send_link_code(conn.assigns.user, phone) do
      json(conn, info)
    end
  end

  def phone_code(_conn, _params), do: {:error, :bad_request}

  @doc "`PUT /api/me/phone` with `{phone, code}`: adds the number to my account."
  def link_phone(conn, %{"phone" => phone, "code" => code})
      when is_binary(phone) and is_binary(code) do
    with {:ok, user} <- Accounts.link_phone(conn.assigns.user, phone, code) do
      json(conn, Wire.me(user))
    end
  end

  def link_phone(_conn, _params), do: {:error, :bad_request}

  @doc "`DELETE /api/me/google` or `/api/me/phone`: allowed while the other way to sign in stays."
  def unlink(conn, %{"what" => what}) when what in ["google", "phone"] do
    with {:ok, user} <- Accounts.unlink(conn.assigns.user, String.to_existing_atom(what)) do
      json(conn, Wire.me(user))
    end
  end

  def unlink(_conn, _params), do: {:error, :not_found}

  @doc ~s(`PUT /api/me/push` with `{token, platform: "fcm" | "apns"}`, for alerts when the app is closed.)
  def push(conn, params) do
    attrs = %{push_token: params["token"], push_platform: params["platform"]}

    with {:ok, _} <- Accounts.set_push_token(conn.assigns.device, attrs) do
      send_resp(conn, 204, "")
    end
  end
end
