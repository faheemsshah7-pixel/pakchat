defmodule PakchatWeb.LinkController do
  @moduledoc """
  Linking a website to a phone by QR code (see `Pakchat.Linking`).

  The website, not signed in:

    * `POST /api/link` with `{"device": {<public keys, name>}, "pre_keys": [...],
      "kyber_pre_keys": [...]}` answers `{"id", "secret", "code", "expires_in"}`.
      Then it joins `"link:<id>"` on `/link/websocket?id=...&secret=...`.
    * `POST /api/link/:id/code` with `{"secret"}` answers a new
      `{"code", "expires_in"}`, or 422 `expired` after the 6th code.
    * `POST /api/link/:id/phone` with `{"secret", "phone", "sealed"?}`, to link
      with a phone number instead: answers the number tidied, `{"phone"}`.
      `sealed` (base64) is the QR text sealed with the code the website shows,
      sent again with each new code.

  The phone (only the main phone, device 1):

    * `GET /api/link/:code` answers the website's `{"name", "identity_key"}`,
      so the phone can check it against the QR before saying yes.
    * `POST /api/link/:code` with `{"provision": "<base64, locked to the QR's key>"}`
      adds the website and answers `{"device_id", "device_uuid"}`. The website
      gets `"linked"` with `{token, user, device_id, device_uuid, provision}`.

    * `GET /api/me/pairing` answers `{"phone", "waiting": [{"sealed", "name"}]}`,
      what websites have sealed for my number.

  And to see and remove linked devices:

    * `GET /api/me/devices` answers `[{"device_id", "name", "linked_at", "last_active", "online"}]`.
    * `DELETE /api/me/devices/:device_id` signs one out (main phone only).
  """
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, Keys, Linking, RateLimit}
  alias PakchatWeb.{Params, Wire}

  action_fallback PakchatWeb.FallbackController

  # A provision holds the phone's identity and a few details, so it is small.
  @max_provision 16_384

  def start(conn, %{"device" => device} = params) do
    with :ok <- RateLimit.hit(:link, ip(conn)),
         {:ok, device_attrs} <- Params.device(device),
         device_attrs =
           if(is_binary(device["name"]),
             do: device_attrs,
             else: %{device_attrs | name: "Browser"}
           ),
         {:ok, keys} <- Params.key_upload(params),
         true <-
           (length(keys.ec) <= 100 and length(keys.kyber) <= 100) || {:error, :too_many_keys},
         :ok <- check_device(device_attrs) do
      json(conn, Linking.start(device_attrs, keys))
    end
  end

  def start(_conn, _params), do: {:error, :bad_request}

  def new_code(conn, %{"id" => id, "secret" => secret}) do
    with :ok <- RateLimit.hit(:link, ip(conn)),
         {:ok, code} <- Linking.new_code(id, secret) do
      json(conn, code)
    end
  end

  def new_code(_conn, _params), do: {:error, :bad_request}

  def phone(conn, %{"id" => id, "secret" => secret, "phone" => typed} = params) do
    with {:ok, sealed} <- sealed(params["sealed"]),
         :ok <- if(sealed, do: :ok, else: RateLimit.hit(:link, ip(conn))),
         {:ok, phone} <- Pakchat.Phone.normalize(typed),
         {:ok, _} <- Linking.set_phone(id, secret, phone, sealed) do
      json(conn, %{phone: phone})
    end
  end

  def phone(_conn, _params), do: {:error, :bad_request}

  def pairing(conn, _params) do
    with :ok <- main_phone(conn) do
      phone = conn.assigns.user.phone
      json(conn, %{phone: phone, waiting: Linking.for_phone(phone)})
    end
  end

  def show(conn, %{"code" => code}) do
    with :ok <- main_phone(conn),
         {:ok, _id, request} <- Linking.find(code) do
      json(conn, %{
        name: request.device.name,
        identity_key: Base.encode64(request.device.identity_key)
      })
    end
  end

  def approve(conn, %{"code" => code, "provision" => provision}) when is_binary(provision) do
    with :ok <- main_phone(conn),
         {:ok, provision_bytes} <- Base.decode64(provision) |> ok_or_bad(),
         true <- byte_size(provision_bytes) <= @max_provision || {:error, :bad_request},
         {:ok, id, request} <- Linking.claim(code) do
      case link(conn.assigns.user, request) do
        {:ok, %{device: device, token: token}} ->
          result = %{
            token: token,
            user: Wire.me(conn.assigns.user),
            device_id: device.device_id,
            device_uuid: device.id,
            provision: provision
          }

          :ok = Linking.finish(id, result)
          PakchatWeb.Endpoint.broadcast("link:" <> id, "linked", result)
          json(conn, %{device_id: device.device_id, device_uuid: device.id})

        {:error, _} = error ->
          Linking.release(id, code)
          error
      end
    end
  end

  def approve(_conn, _params), do: {:error, :bad_request}

  def devices(conn, _params) do
    user_id = conn.assigns.user.id
    connected = Pakchat.Presence.list(Pakchat.Presence.topic(user_id))

    devices =
      for d <- Accounts.list_devices(user_id) do
        %{
          device_id: d.device_id,
          name: d.name,
          linked_at: d.inserted_at,
          last_active: d.last_active_at,
          online: Map.has_key?(connected, d.id)
        }
      end

    json(conn, devices)
  end

  def remove(conn, %{"device_id" => device_id}) do
    with :ok <- main_phone(conn),
         {n, ""} when n > 1 <- Integer.parse(device_id),
         %{} = device <-
           Enum.find(Accounts.list_devices(conn.assigns.user.id), &(&1.device_id == n)) do
      :ok = Accounts.sign_out(device)
      send_resp(conn, 204, "")
    else
      {:error, _} = error -> error
      _ -> {:error, :not_found}
    end
  end

  defp link(user, request) do
    with {:ok, %{device: device}} = linked <- Accounts.add_linked_device(user, request.device) do
      case Keys.add_pre_keys(device, request.keys.ec, request.keys.kyber) do
        {:ok, _} ->
          linked

        error ->
          Accounts.sign_out(device)
          error
      end
    end
  end

  # Only the phone that signed up can link or remove other devices, the same
  # as WhatsApp, so a linked website can't quietly add another one.
  defp main_phone(conn) do
    if conn.assigns.device.device_id == 1, do: :ok, else: {:error, :forbidden}
  end

  # Checks the keys now, so a bad request fails here and not when the phone approves.
  defp check_device(attrs) do
    changeset =
      Accounts.Device.register_changeset(
        %Accounts.Device{},
        Map.merge(attrs, %{user_id: Ecto.UUID.generate(), device_id: 2, token_hash: "x"})
      )

    if changeset.valid?, do: :ok, else: {:error, changeset}
  end

  # A sealed QR text is small: a few hundred bytes.
  defp sealed(nil), do: {:ok, nil}

  defp sealed(text) when is_binary(text) and byte_size(text) <= 1024 do
    case Base.decode64(text) do
      {:ok, bytes} when byte_size(bytes) > 28 -> {:ok, text}
      _ -> {:error, :bad_request}
    end
  end

  defp sealed(_), do: {:error, :bad_request}

  defp ok_or_bad({:ok, _} = ok), do: ok
  defp ok_or_bad(:error), do: {:error, :bad_request}

  defp ip(conn), do: conn.remote_ip |> :inet.ntoa() |> to_string()
end
