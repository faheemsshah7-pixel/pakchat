defmodule PakchatWeb.MeController do
  @moduledoc "My own profile and privacy settings, and my push token."
  use PakchatWeb, :controller
  alias Pakchat.Accounts
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

  @doc ~s(`PUT /api/me/push` with `{token, platform: "fcm" | "apns"}`, for alerts when the app is closed.)
  def push(conn, params) do
    attrs = %{push_token: params["token"], push_platform: params["platform"]}

    with {:ok, _} <- Accounts.set_push_token(conn.assigns.device, attrs) do
      send_resp(conn, 204, "")
    end
  end
end
