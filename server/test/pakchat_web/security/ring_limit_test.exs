defmodule PakchatWeb.Security.RingLimitTest do
  @moduledoc "A caller can't make someone's phone ring over and over: rings are limited per caller."
  use Pakchat.DataCase, async: false
  import Pakchat.Fixtures
  alias Pakchat.{Chats, Relay}

  setup do
    limits = Application.fetch_env!(:pakchat, :rate_limits)
    on_exit(fn -> Application.put_env(:pakchat, :rate_limits, limits) end)
    Application.put_env(:pakchat, :rate_limits, Keyword.put(limits, :rings, {3, 60_000}))
    :ok
  end

  test "rings are limited; other call messages are not" do
    caller = person("Caller")
    target = person("Target")
    {:ok, chat} = Chats.get_or_create_direct(caller.user, target.user.id)

    call = fn ring ->
      Relay.send_call(caller.device, chat.id, %{
        ring: ring,
        envelopes: [
          %{user_id: target.user.id, device_id: target.device.device_id, type: 2, body: "x"}
        ]
      })
    end

    results = for _ <- 1..5, do: call.(true)
    assert Enum.take(results, 3) == [:ok, :ok, :ok]
    assert {:error, :rate_limited} in results
    # Connection details during a call still go.
    assert :ok = call.(false)
  end
end
