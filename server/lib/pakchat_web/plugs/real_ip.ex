defmodule PakchatWeb.Plugs.RealIp do
  @moduledoc """
  On the live server every visitor reaches PakChat through Caddy (deploy/Caddyfile),
  so they'd all look like Caddy's own address, and limits meant per person (like
  10 sign-ins a minute) would count everyone together. Caddy passes the real
  address along in `X-Forwarded-For`, so when a request comes from a private
  address (Caddy, next to us in Docker) we use the last address in that header:
  the one Caddy added itself. Anyone else can't fake it, because a request from
  the internet never has a private address.
  """
  @behaviour Plug

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts) do
    with true <- private?(conn.remote_ip),
         [header | _] <- Plug.Conn.get_req_header(conn, "x-forwarded-for"),
         last when last != "" <- header |> String.split(",") |> List.last() |> String.trim(),
         {:ok, ip} <- :inet.parse_address(String.to_charlist(last)) do
      %{conn | remote_ip: ip}
    else
      _ -> conn
    end
  end

  defp private?({10, _, _, _}), do: true
  defp private?({172, b, _, _}) when b in 16..31, do: true
  defp private?({192, 168, _, _}), do: true
  defp private?({127, _, _, _}), do: true
  defp private?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  defp private?({a, _, _, _, _, _, _, _}) when a in 0xFC00..0xFDFF, do: true
  defp private?(_), do: false
end
