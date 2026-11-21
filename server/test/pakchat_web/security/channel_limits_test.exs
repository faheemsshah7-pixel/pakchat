defmodule PakchatWeb.Security.ChannelLimitsTest do
  @moduledoc """
  Every event on the live connection is limited per device, so one device
  can't make the server shout "typing…" at a big group without end, or ask
  for everything waiting again and again.
  """
  use PakchatWeb.ChannelCase
  import Pakchat.Fixtures
  alias Pakchat.Chats
  alias Phoenix.Socket.Message

  setup do
    limits = Application.fetch_env!(:pakchat, :rate_limits)
    on_exit(fn -> Application.put_env(:pakchat, :rate_limits, limits) end)

    Application.put_env(
      :pakchat,
      :rate_limits,
      Keyword.merge(limits, typing: {5, 10_000}, sync: {3, 60_000}, live_events: {10, 10_000})
    )

    :ok
  end

  test "typing is limited per device" do
    ali = person("Ali")
    sara = person("Sara")
    {:ok, chat} = Chats.get_or_create_direct(ali.user, sara.user.id)
    a = online(ali.token, ali.device)
    _s = online(sara.token, sara.device)

    for _ <- 1..20, do: push(a, "typing", %{"chat_id" => chat.id, "typing" => true})
    Process.sleep(300)

    topic = "device:" <> sara.device.id

    got =
      Stream.repeatedly(fn ->
        receive do
          %Message{topic: ^topic, event: "typing"} -> 1
        after
          50 -> nil
        end
      end)
      |> Enum.take_while(& &1)
      |> length()

    assert got <= 5
  end

  test "sync and the other events are limited per device" do
    ali = person("Ali")
    a = online(ali.token, ali.device)

    replies =
      for _ <- 1..5 do
        ref = push(a, "sync", %{"after" => %{}})
        assert_reply ref, status, reply, 1000
        {status, reply}
      end

    assert {:error, %{reason: :rate_limited}} in replies

    replies =
      for _ <- 1..15 do
        ref = push(a, "active", %{"active" => true})
        assert_reply ref, status, reply, 1000
        {status, reply}
      end

    assert {:error, %{reason: :rate_limited}} in replies
  end
end
