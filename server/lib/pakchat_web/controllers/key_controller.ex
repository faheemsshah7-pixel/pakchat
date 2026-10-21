defmodule PakchatWeb.KeyController do
  @moduledoc "Signal public keys: uploading mine, and taking someone else's to start a chat."
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, Keys, RateLimit}
  alias PakchatWeb.{Params, Wire}

  action_fallback PakchatWeb.FallbackController

  @doc "`GET /api/keys`: how many one-time keys I have left."
  def count(conn, _params), do: json(conn, Keys.counts(conn.assigns.device))

  @doc "`POST /api/keys`: more one-time keys, and/or a new signed pre-key or last-resort key."
  def upload(conn, params) do
    device = conn.assigns.device

    with {:ok, keys} <- Params.key_upload(params),
         {:ok, device} <- rotate(device, keys.rotate),
         {:ok, counts} <- Keys.add_pre_keys(device, keys.ec, keys.kyber) do
      json(conn, counts)
    end
  end

  defp rotate(device, rotate) when rotate == %{}, do: {:ok, device}
  defp rotate(device, rotate), do: Keys.rotate(device, rotate)

  @doc "`GET /api/users/:id/devices`: someone's device numbers."
  def devices(conn, %{"id" => id}) do
    with %{} = user <- Accounts.get_user(id) do
      json(conn, %{devices: Enum.map(Accounts.list_devices(user.id), & &1.device_id)})
    end
  end

  @doc """
  `POST /api/users/:id/bundles`, optionally with `{"device_ids": [1, 2]}`:
  a key bundle for each of their devices. Each call uses up one-time keys,
  so it is rate-limited.
  """
  def bundles(conn, %{"id" => id} = params) do
    device_ids = if is_list(params["device_ids"]), do: params["device_ids"]

    with :ok <- RateLimit.hit(:keys, conn.assigns.user.id),
         %{} = user <- Accounts.get_user(id),
         {:ok, bundles} <- Keys.claim_bundles(user.id, device_ids) do
      json(conn, %{bundles: Enum.map(bundles, &Wire.bundle/1)})
    end
  end
end
