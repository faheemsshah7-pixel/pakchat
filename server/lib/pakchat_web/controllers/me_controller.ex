defmodule PakchatWeb.MeController do
  @moduledoc "My own profile and privacy settings, and my push token."
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, Files, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  def show(conn, _params), do: json(conn, Wire.me(conn.assigns.user))

  @doc """
  `PUT /api/me/pin` with `{"pin": "123456"}`: two-step verification on, or a new PIN
  (Pakchat.Pin). Changing it needs the one it has now too, as `"current"` (403
  `wrong_current` if it isn't).
  """
  def set_pin(conn, %{"pin" => pin} = params) do
    with :ok <- current_pin(conn, params),
         {:ok, user} <- Pakchat.Pin.set(conn.assigns.user, pin),
         do: json(conn, Wire.me(user))
  end

  def set_pin(_conn, _params), do: {:error, :bad_request}

  @doc "`DELETE /api/me/pin` with `{\"current\"}`: two-step verification off."
  def remove_pin(conn, params) do
    with :ok <- current_pin(conn, params),
         {:ok, user} <- Pakchat.Pin.remove(conn.assigns.user),
         do: json(conn, Wire.me(user))
  end

  # Tries are limited like the reminder's, so the PIN can't be guessed from a phone left unlocked.
  defp current_pin(conn, params) do
    user = conn.assigns.user

    cond do
      not Pakchat.Pin.on?(user) -> :ok
      RateLimit.hit(:pin_check, user.id) != :ok -> {:error, :rate_limited}
      Pakchat.Pin.mine?(user, params["current"]) -> :ok
      true -> {:error, :wrong_current}
    end
  end

  @doc "`POST /api/me/pin/check` with `{\"pin\"}`: `{\"right\": true | false}` (the reminder now and then)."
  def check_pin(conn, %{"pin" => pin}) do
    with :ok <- RateLimit.hit(:pin_check, conn.assigns.user.id),
         {:ok, right} <- Pakchat.Pin.check_mine(conn.assigns.user, pin) do
      json(conn, %{right: right})
    end
  end

  def check_pin(_conn, _params), do: {:error, :bad_request}

  @doc """
  `PATCH /api/me` with any of: name, about, photo, and
  `privacy: {last_seen: "everyone" | "contacts" | "nobody",
  online: "everyone" | "same", photo: "everyone" | "contacts" | "nobody",
  about: "everyone" | "contacts" | "nobody", groups: "everyone" | "contacts",
  read_receipts: true | false, except: %{last_seen | photo | about | groups => [user ids]}}`.
  Last seen, photo, About and groups can also be "except": my contacts except the
  people in `except` for it ("My contacts except…"). An `except` list given
  replaces that setting's list; the others stay. A new photo deletes the old one's file.
  """
  def update(conn, params) do
    privacy = if is_map(params["privacy"]), do: params["privacy"], else: %{}

    attrs =
      params
      |> Map.take(["name", "about", "photo"])
      |> put_if(privacy, "last_seen", "last_seen_visibility")
      |> put_if(privacy, "online", "online_visibility")
      |> put_if(privacy, "photo", "photo_visibility")
      |> put_if(privacy, "about", "about_visibility")
      |> put_if(privacy, "groups", "groups_visibility")
      |> put_if(privacy, "read_receipts", "read_receipts")
      |> put_except(privacy["except"], conn.assigns.user)

    was = conn.assigns.user.photo

    with {:ok, user} <- Accounts.update_profile(conn.assigns.user, attrs) do
      if user.photo != was, do: Files.forget_photo(was)
      json(conn, Wire.me(user))
    end
  end

  # Only the lists given change; anything not a map is passed on to be refused.
  defp put_except(attrs, nil, _user), do: attrs

  defp put_except(attrs, given, user) when is_map(given),
    do: Map.put(attrs, "privacy_except", Map.merge(user.privacy_except || %{}, given))

  defp put_except(attrs, given, _user), do: Map.put(attrs, "privacy_except", given)

  defp put_if(attrs, from, key, as) do
    if Map.has_key?(from, key), do: Map.put(attrs, as, from[key]), else: attrs
  end

  @doc """
  `PUT /api/me/google` with `{id_token, move?}`: adds a Gmail to my account (I signed in
  by phone). 409 `taken` if it has its own account; `move: true` moves it here.
  """
  def link_google(conn, %{"id_token" => id_token} = p) when is_binary(id_token) do
    with {:ok, user} <- Accounts.link_google(conn.assigns.user, id_token, move: p["move"] == true) do
      json(conn, Wire.me(user))
    end
  end

  def link_google(_conn, _params), do: {:error, :bad_request}

  @doc "`POST /api/me/phone/code` with `{phone, move?}`: sends a code to a number I want to add."
  def phone_code(conn, %{"phone" => phone} = p) when is_binary(phone) do
    with :ok <- RateLimit.hit(:sms, conn.assigns.user.id),
         {:ok, info} <- Accounts.send_link_code(conn.assigns.user, phone, move: p["move"] == true) do
      json(conn, info)
    end
  end

  def phone_code(_conn, _params), do: {:error, :bad_request}

  @doc "`PUT /api/me/phone` with `{phone, code, move?}`: adds the number to my account."
  def link_phone(conn, %{"phone" => phone, "code" => code} = p)
      when is_binary(phone) and is_binary(code) do
    with {:ok, user} <-
           Accounts.link_phone(conn.assigns.user, phone, code, move: p["move"] == true) do
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

  @doc """
  `DELETE /api/me` with `{confirm}`: deletes my account for good (Settings › Account ›
  Delete my account). Only from the phone, like WhatsApp (a linked website can't), and
  only when `confirm` is my number (or my Gmail, when I have no number):
  422 `wrong_confirm` otherwise. Every device is signed out at once.
  """
  def delete(conn, params) do
    if conn.assigns.device.device_id == 1 do
      with :ok <- Accounts.delete_my_account(conn.assigns.user, params["confirm"]) do
        send_resp(conn, 204, "")
      end
    else
      {:error, :forbidden}
    end
  end

  @doc ~s(`PUT /api/me/push` with `{token, platform: "fcm" | "apns"}`, for alerts when the app is closed.)
  def push(conn, params) do
    attrs = %{push_token: params["token"], push_platform: params["platform"]}

    with {:ok, _} <- Accounts.set_push_token(conn.assigns.device, attrs) do
      send_resp(conn, 204, "")
    end
  end
end
