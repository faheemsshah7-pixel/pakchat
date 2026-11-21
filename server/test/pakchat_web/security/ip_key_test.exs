defmodule PakchatWeb.Security.IpKeyTest do
  @moduledoc """
  One IPv6 connection gets a whole /64 (billions of addresses), so limits per
  address count an IPv6 /64 as one. IPv4 stays per address.
  """
  use PakchatWeb.ConnCase, async: false
  import Pakchat.Fixtures
  alias Pakchat.RateLimit

  test "IPv6 addresses in one /64 count as one; IPv4 per address" do
    assert RateLimit.ip_key({0x2001, 0xDB8, 1, 2, 3, 4, 5, 6}) ==
             RateLimit.ip_key({0x2001, 0xDB8, 1, 2, 9, 9, 9, 9})

    refute RateLimit.ip_key({0x2001, 0xDB8, 1, 2, 3, 4, 5, 6}) ==
             RateLimit.ip_key({0x2001, 0xDB8, 1, 3, 3, 4, 5, 6})

    assert RateLimit.ip_key({1, 2, 3, 4}) == "1.2.3.4"
    refute RateLimit.ip_key({1, 2, 3, 4}) == RateLimit.ip_key({1, 2, 3, 5})
    # An IPv4 address written as IPv6 is the same address.
    assert RateLimit.ip_key({0, 0, 0, 0, 0, 0xFFFF, 0x0102, 0x0304}) == "1.2.3.4"
  end

  test "sign-in tries from many addresses in one /64 share one limit" do
    limits = Application.fetch_env!(:pakchat, :rate_limits)
    on_exit(fn -> Application.put_env(:pakchat, :rate_limits, limits) end)
    Application.put_env(:pakchat, :rate_limits, Keyword.put(limits, :sign_in, {10, 60_000}))

    statuses =
      for n <- 1..12 do
        build_conn()
        |> Map.put(:remote_ip, {0x2001, 0xDB8, 7, 7, n, n, n, n})
        |> post(~p"/api/auth/google", %{"id_token" => "bad", "device" => device_params()})
        |> Map.get(:status)
      end

    assert 429 in statuses
  end
end
