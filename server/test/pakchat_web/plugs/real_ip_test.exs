defmodule PakchatWeb.Plugs.RealIpTest do
  use ExUnit.Case, async: true
  import Plug.Test
  import Plug.Conn
  alias PakchatWeb.Plugs.RealIp

  defp from(remote, forwarded) do
    conn = %{conn(:get, "/") | remote_ip: remote}
    conn = if forwarded, do: put_req_header(conn, "x-forwarded-for", forwarded), else: conn
    RealIp.call(conn, RealIp.init([])).remote_ip
  end

  test "behind Caddy, each visitor is their own address" do
    assert from({172, 18, 0, 5}, "203.0.113.7") == {203, 0, 113, 7}
    # The last address is the one Caddy added; earlier ones could be made up.
    assert from({172, 18, 0, 5}, "1.2.3.4, 203.0.113.7") == {203, 0, 113, 7}
  end

  test "someone on the internet can't pretend to be someone else" do
    assert from({203, 0, 113, 7}, "1.2.3.4") == {203, 0, 113, 7}
  end

  test "without the header, or with nonsense in it, nothing changes" do
    assert from({172, 18, 0, 5}, nil) == {172, 18, 0, 5}
    assert from({172, 18, 0, 5}, "not-an-address") == {172, 18, 0, 5}
  end
end
