defmodule PakchatWeb.DeviceSocket do
  @moduledoc """
  The always-open connection between a device and the server.

  The app connects to `/socket/websocket?token=<session token>`. A wrong or
  old token is turned away. Over this one connection the device joins its
  own channel, `"device:<its id>"` (see `PakchatWeb.DeviceChannel`).
  """
  use Phoenix.Socket
  alias Pakchat.Accounts

  channel "device:*", PakchatWeb.DeviceChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Accounts.device_by_token(token) do
      %{} = device -> {:ok, assign(socket, :device, %{device | user: nil})}
      nil -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  # Naming the connection lets the server close it when the device signs out.
  @impl true
  def id(socket), do: "device_socket:" <> socket.assigns.device.id
end
