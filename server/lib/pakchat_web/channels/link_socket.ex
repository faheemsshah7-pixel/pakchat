defmodule PakchatWeb.LinkSocket do
  @moduledoc """
  The connection a website keeps open while it shows its QR code, before
  it is signed in (see `Pakchat.Linking`).

  It connects to `/link/websocket?id=<id>&secret=<secret>` and joins
  `"link:<id>"`. When the phone approves, it gets `"linked"` with its
  session token and closes this connection.
  """
  use Phoenix.Socket

  channel "link:*", PakchatWeb.LinkChannel

  @impl true
  def connect(%{"id" => id, "secret" => secret}, socket, _connect_info) do
    case Pakchat.Linking.check(id, secret) do
      {:ok, _} -> {:ok, assign(socket, :link_id, id)}
      {:error, _} -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(_socket), do: nil
end

defmodule PakchatWeb.LinkChannel do
  @moduledoc """
  `"link:<id>"`: tells a waiting website that the phone said yes. If that
  already happened while it was reconnecting, the join answers with it.
  """
  use Phoenix.Channel

  @impl true
  def join("link:" <> id, _params, %{assigns: %{link_id: id}} = socket) do
    case :ets.lookup(Pakchat.Linking, {:id, id}) do
      [{_, %{result: nil}}] -> {:ok, socket}
      [{_, %{result: result}}] -> {:ok, %{linked: result}, socket}
      [] -> {:error, %{reason: "expired"}}
    end
  end

  def join(_topic, _params, _socket), do: {:error, %{reason: "not_found"}}

  # The website has its token; nothing more to wait for.
  @impl true
  def handle_in("done", _payload, socket) do
    Pakchat.Linking.drop(socket.assigns.link_id)
    {:stop, :normal, :ok, socket}
  end
end
