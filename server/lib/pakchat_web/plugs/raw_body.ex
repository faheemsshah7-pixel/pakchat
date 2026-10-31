defmodule PakchatWeb.Plugs.RawBody do
  @moduledoc """
  Keeps the exact bytes of Meta's WhatsApp webhook messages (in
  `conn.assigns.raw_body`), because Meta's signature is over those bytes, not
  over the JSON once it's read. Every other request is read as usual.
  """

  @webhook "/api/whatsapp/webhook"

  def read_body(%Plug.Conn{request_path: @webhook} = conn, opts) do
    with {:ok, body, conn} <- read_all(conn, opts, "") do
      {:ok, body, Plug.Conn.assign(conn, :raw_body, body)}
    end
  end

  def read_body(conn, opts), do: Plug.Conn.read_body(conn, opts)

  defp read_all(conn, opts, acc) do
    case Plug.Conn.read_body(conn, opts) do
      {:ok, body, conn} -> {:ok, acc <> body, conn}
      {:more, body, conn} -> read_all(conn, opts, acc <> body)
      other -> other
    end
  end
end
