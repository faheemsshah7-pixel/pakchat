defmodule PakchatWeb.DeviceChannelTest do
  @moduledoc """
  The live connection: sending, holding, delivering and deleting envelopes,
  ticks, typing, online and last seen, and who may do what.
  """
  # Not async: these tests share Presence and the live connections.
  use PakchatWeb.ChannelCase
  use Oban.Testing, repo: Pakchat.Repo

  import Ecto.Query
  alias Pakchat.{Accounts, Chats, Relay, Repo}
  alias Pakchat.Relay.Envelope
  alias Phoenix.Socket.Message

  setup do
    ali = person("Ali")
    sara = person("Sara")
    bilal = person("Bilal")
    {:ok, chat} = Chats.get_or_create_direct(ali.user, sara.user.id)
    %{ali: ali, sara: sara, bilal: bilal, chat: chat}
  end

  ## Helpers

  # A locked envelope for one device. The words are just bytes to the server.
  defp sealed(%{user: user, device: device}, text \\ "locked") do
    %{
      "user_id" => user.id,
      "device_id" => device.device_id,
      "type" => 2,
      "body" => Base.encode64(text)
    }
  end

  defp send_msg(socket, chat_id, envelopes, extra \\ %{}) do
    ref =
      push(socket, "send", Map.merge(%{"chat_id" => chat_id, "envelopes" => envelopes}, extra))

    assert_reply ref, status, reply, 1000
    {status, reply}
  end

  # Waits for envelopes pushed to one device.
  defp envelopes_for(device) do
    topic = "device:" <> device.id
    assert_receive %Message{topic: ^topic, event: "envelopes", payload: %{envelopes: list}}, 1000
    list
  end

  defp refute_envelopes(device) do
    topic = "device:" <> device.id
    refute_receive %Message{topic: ^topic, event: "envelopes"}, 200
  end

  defp waiting(device) do
    Repo.aggregate(from(e in Envelope, where: e.device_id == ^device.id), :count)
  end

  defp offline(socket) do
    Process.unlink(socket.channel_pid)
    ref = Process.monitor(socket.channel_pid)
    close(socket)
    assert_receive {:DOWN, ^ref, _, _, _}
  end

  ## Who can connect and listen

  test "a wrong token can't connect" do
    assert :error = connect(PakchatWeb.DeviceSocket, %{"token" => "made-up"})
    assert :error = connect(PakchatWeb.DeviceSocket, %{})
  end

  test "nobody can listen to another device's channel", %{ali: ali, sara: sara} do
    {:ok, socket} = connect(PakchatWeb.DeviceSocket, %{"token" => ali.token})
    topic = "device:" <> sara.device.id
    assert {:error, %{reason: "not_yours"}} = PakchatWeb.DeviceChannel.join(topic, %{}, socket)
  end

  ## Sending and delivering

  test "a message reaches an online device, and is deleted once it says got it", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    a = online(ali.token, ali.device)
    _s = online(sara.token, sara.device)

    assert {:ok, %{seq: 1}} = send_msg(a, chat.id, [sealed(sara, "salaam")])

    [env] = envelopes_for(sara.device)
    assert env.from == ali.user.id
    assert env.from_device == 1
    assert env.seq == 1
    assert env.kind == "message"
    assert Base.decode64!(env.body) == "salaam"
    assert waiting(sara.device) == 1

    # Ali can't delete what's waiting for Sara.
    ref = push(a, "ack", %{"ids" => [env.id]})
    assert_reply ref, :ok
    assert waiting(sara.device) == 1

    s = online(sara.token, sara.device)
    _ = envelopes_for(sara.device)
    ref = push(s, "ack", %{"ids" => [env.id]})
    assert_reply ref, :ok
    assert waiting(sara.device) == 0
  end

  test "the server stamps who it's from; a device can't pretend to be someone else", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    a = online(ali.token, ali.device)
    online(sara.token, sara.device)

    send_msg(a, chat.id, [sealed(sara)], %{"from" => sara.user.id, "sender_id" => sara.user.id})
    [env] = envelopes_for(sara.device)
    assert env.from == ali.user.id
  end

  test "an offline device gets everything, in order, when it comes back", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    Accounts.set_push_token(sara.device, %{push_token: "fcm-token", push_platform: "fcm"})
    a = online(ali.token, ali.device)

    for text <- ["one", "two", "three"] do
      assert {:ok, _} = send_msg(a, chat.id, [sealed(sara, text)])
    end

    assert waiting(sara.device) == 3
    # An empty push alert wakes her phone, once, not three times.
    assert_enqueued(worker: Pakchat.Push.Notify, args: %{device_id: sara.device.id})
    assert length(all_enqueued(worker: Pakchat.Push.Notify)) == 1

    online(sara.token, sara.device)
    list = envelopes_for(sara.device)
    assert Enum.map(list, &Base.decode64!(&1.body)) == ["one", "two", "three"]
    assert Enum.map(list, & &1.seq) == [1, 2, 3]
  end

  test "a connected phone that doesn't collect a message is pushed after 3 s", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    Accounts.set_push_token(sara.device, %{push_token: "fcm-token", push_platform: "fcm"})
    a = online(ali.token, ali.device)
    online(sara.token, sara.device)
    before = DateTime.add(DateTime.utc_now(), -5, :second)

    send_msg(a, chat.id, [sealed(sara, "are you there?")])
    [env] = envelopes_for(sara.device)

    # Not now: it's connected. A check in 3 seconds instead.
    assert [job] = all_enqueued(worker: Pakchat.Push.Notify)
    assert job.args == %{"device_id" => sara.device.id, "if_waiting" => true, "call" => false}
    assert DateTime.diff(job.scheduled_at, DateTime.utc_now()) in 1..3

    # Still waiting then (a dead connection): it's pushed. Collected: it isn't.
    assert Relay.waiting?(sara.device.id, before)
    Relay.ack(sara.device, [env.id])
    refute Relay.waiting?(sara.device.id, before)
    assert :ok = perform_job(Pakchat.Push.Notify, job.args)
  end

  test "ticks don't wake a closed app, and my own messages don't wake my other devices", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    Accounts.set_push_token(ali.device, %{push_token: "ali-phone", push_platform: "fcm"})
    ali_web = linked(ali.user)
    Accounts.set_push_token(ali_web.device, %{push_token: "ali-web", push_platform: "fcm"})
    s = online(sara.token, sara.device)

    ref =
      push(s, "receipt", %{
        "chat_id" => chat.id,
        "to" => ali.user.id,
        "status" => "read",
        "seqs" => [1]
      })

    assert_reply ref, :ok
    assert all_enqueued(worker: Pakchat.Push.Notify) == []

    # Ali's phone sends; his linked website gets a copy but no alert.
    a = online(ali.token, ali.device)
    send_msg(a, chat.id, [sealed(sara), sealed(Map.put(ali_web, :user, ali.user))])
    refute_enqueued(worker: Pakchat.Push.Notify, args: %{device_id: ali_web.device.id})
  end

  test "\"I already have up to N\" skips and deletes those", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    a = online(ali.token, ali.device)
    for text <- ["one", "two", "three"], do: send_msg(a, chat.id, [sealed(sara, text)])

    online(sara.token, sara.device, %{"after" => %{chat.id => 2}})
    assert [%{seq: 3}] = envelopes_for(sara.device)
    assert waiting(sara.device) == 1
  end

  test "envelopes nobody collects are deleted after 30 days", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    a = online(ali.token, ali.device)
    send_msg(a, chat.id, [sealed(sara)])

    # Pretend 31 days have passed.
    Repo.update_all(Envelope, set: [expires_at: DateTime.add(DateTime.utc_now(), -1, :day)])
    assert :ok = perform_job(Pakchat.Relay.Cleanup, %{})
    assert waiting(sara.device) == 0
  end

  ## Several devices

  test "a message must be locked for every device, including my own others", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    sara_web = linked(sara.user)
    ali_web = linked(ali.user)
    a = online(ali.token, ali.device)

    # Out of date: Ali's phone doesn't know about Sara's website or his own.
    assert {:error, %{reason: "stale_devices", missing: missing, extra: []}} =
             send_msg(a, chat.id, [sealed(sara)])

    assert Enum.sort_by(missing, & &1.user_id) ==
             Enum.sort_by(
               [%{user_id: sara.user.id, device_id: 2}, %{user_id: ali.user.id, device_id: 2}],
               & &1.user_id
             )

    # A device that doesn't exist.
    ghost = %{"user_id" => sara.user.id, "device_id" => 7, "type" => 2, "body" => "AA=="}

    assert {:error, %{reason: "stale_devices", extra: [%{device_id: 7}]}} =
             send_msg(a, chat.id, [sealed(sara), sealed(%{sara | device: sara_web.device}), ghost])

    # Nothing was sent by the failed tries.
    assert waiting(sara.device) == 0

    everyone = [
      sealed(sara),
      sealed(%{sara | device: sara_web.device}),
      sealed(%{ali | device: ali_web.device})
    ]

    assert {:ok, _} = send_msg(a, chat.id, everyone)
    assert waiting(sara.device) == 1
    assert waiting(sara_web.device) == 1
    assert waiting(ali_web.device) == 1
    # Never back to the device that sent it.
    assert waiting(ali.device) == 0
  end

  test "messaging yourself from your only device still gets a number", ctx do
    %{ali: ali} = ctx
    {:ok, me_chat} = Chats.get_or_create_direct(ali.user, ali.user.id)
    a = online(ali.token, ali.device)
    assert {:ok, %{seq: 1}} = send_msg(a, me_chat.id, [])
  end

  ## Who can send where

  test "nobody can send to a chat they're not in", ctx do
    %{bilal: bilal, sara: sara, chat: chat} = ctx
    b = online(bilal.token, bilal.device)

    assert {:error, %{reason: :not_found}} = send_msg(b, chat.id, [sealed(sara)])
    assert {:error, %{reason: :not_found}} = send_msg(b, Ecto.UUID.generate(), [sealed(sara)])
    assert {:error, %{reason: :not_found}} = send_msg(b, "nonsense", [sealed(sara)])
    assert waiting(sara.device) == 0
  end

  test "groups: locked once, copied to every member's devices", ctx do
    %{ali: ali, sara: sara, bilal: bilal} = ctx

    {:ok, group} =
      Chats.create_group(ali.user, %{"title" => "Study"}, [sara.user.id, bilal.user.id])

    a = online(ali.token, ali.device)
    online(sara.token, sara.device)
    online(bilal.token, bilal.device)

    # Everyone hears the group was made.
    assert [%{kind: "system", data: %{"event" => "created"}}] = envelopes_for(sara.device)
    _ = envelopes_for(bilal.device)

    group_body = %{"type" => 7, "body" => Base.encode64("locked once")}
    assert {:ok, %{seq: 2}} = send_msg(a, group.id, [], %{"group" => group_body})

    for who <- [sara, bilal] do
      assert [%{type: 7, seq: 2, from: from}] = envelopes_for(who.device)
      assert from == ali.user.id
    end

    # Bilal is removed: he hears it, then gets nothing more.
    {:ok, _} = Chats.remove_member(ali.user, group.id, bilal.user.id)
    assert [%{data: %{"event" => "removed"}}] = envelopes_for(bilal.device)
    _ = envelopes_for(sara.device)

    send_msg(a, group.id, [], %{"group" => group_body})
    _ = envelopes_for(sara.device)
    refute_envelopes(bilal.device)

    b = online(bilal.token, bilal.device)
    assert {:error, %{reason: :not_found}} = send_msg(b, group.id, [], %{"group" => group_body})
  end

  test "only admins can send, but everyone can still react", ctx do
    %{ali: ali, sara: sara} = ctx

    {:ok, group} =
      Chats.create_group(ali.user, %{"title" => "News", "only_admins_send" => true}, [
        sara.user.id
      ])

    s = online(sara.token, sara.device)
    a = online(ali.token, ali.device)
    body = %{"type" => 7, "body" => Base.encode64("x")}

    assert {:error, %{reason: :admins_only}} = send_msg(s, group.id, [], %{"group" => body})
    assert {:ok, _} = send_msg(s, group.id, [], %{"group" => body, "kind" => "reaction"})
    assert {:ok, _} = send_msg(a, group.id, [], %{"group" => body})
  end

  test "groups: a sender's device list that's out of date gets stale_devices", ctx do
    %{ali: ali, sara: sara, bilal: bilal} = ctx

    {:ok, group} =
      Chats.create_group(ali.user, %{"title" => "Study"}, [sara.user.id, bilal.user.id])

    a = online(ali.token, ali.device)
    body = %{"type" => 7, "body" => Base.encode64("locked once")}
    dev = fn who -> %{"user_id" => who.user.id, "device_id" => who.device.device_id} end

    # Right: everyone's devices except the one sending.
    assert {:ok, _} =
             send_msg(a, group.id, [], %{"group" => body, "devices" => [dev.(sara), dev.(bilal)]})

    # Sara links the website. Ali doesn't know yet, so he's told.
    web = linked(sara.user)

    assert {:error, %{reason: "stale_devices", missing: [missing], extra: []}} =
             send_msg(a, group.id, [], %{"group" => body, "devices" => [dev.(sara), dev.(bilal)]})

    assert missing == %{user_id: sara.user.id, device_id: web.device.device_id}

    # Bilal leaves. A list that still has him is out of date too.
    {:ok, _} = Chats.remove_member(bilal.user, group.id, bilal.user.id)
    all = [dev.(sara), %{"user_id" => sara.user.id, "device_id" => 2}, dev.(bilal)]

    assert {:error, %{reason: "stale_devices", missing: [], extra: [extra]}} =
             send_msg(a, group.id, [], %{"group" => body, "devices" => all})

    assert extra == %{user_id: bilal.user.id, device_id: 1}

    # Without a list, the server doesn't check (as before).
    assert {:ok, _} = send_msg(a, group.id, [], %{"group" => body})

    # A bad list is refused.
    assert {:error, %{reason: :bad_request}} =
             send_msg(a, group.id, [], %{"group" => body, "devices" => [%{"user_id" => "x"}]})
  end

  test "control messages: just a few devices, and allowed when only admins can send", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    web = linked(sara.user)
    a = online(ali.token, ali.device)
    online(sara.token, sara.device)
    s_web = online(web.token, web.device)

    # "Please send that again", from Sara's website to Ali's phone only. A normal
    # message would have to cover every device; a control one doesn't.
    retry = [sealed(ali, "please resend")]
    assert {:error, %{reason: "stale_devices"}} = send_msg(s_web, chat.id, retry)
    assert {:ok, _} = send_msg(s_web, chat.id, retry, %{"kind" => "control"})
    assert [%{kind: "control", from_device: 2}] = envelopes_for(ali.device)
    refute_envelopes(sara.device)

    # Still only for devices in the chat.
    assert {:error, %{reason: "stale_devices", extra: [_]}} =
             send_msg(a, chat.id, [sealed(ctx.bilal)], %{"kind" => "control"})

    # No group copy, and something to send.
    {:ok, news} =
      Chats.create_group(ali.user, %{"title" => "News", "only_admins_send" => true}, [
        sara.user.id
      ])

    group_body = %{"type" => 7, "body" => Base.encode64("x")}

    assert {:error, %{reason: :bad_request}} =
             send_msg(s_web, news.id, [], %{"kind" => "control", "group" => group_body})

    assert {:error, %{reason: :bad_request}} =
             send_msg(s_web, news.id, [], %{"kind" => "control"})

    # In an admins-only group, Sara can't send a message but can send a control one.
    assert {:error, %{reason: :admins_only}} = send_msg(s_web, news.id, [sealed(ali)])
    assert {:ok, _} = send_msg(s_web, news.id, [sealed(ali)], %{"kind" => "control"})
  end

  ## Blocking

  test "someone who blocked you never gets your messages, and you can't tell", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    :ok = Accounts.block(sara.user, ali.user)
    a = online(ali.token, ali.device)
    online(sara.token, sara.device)

    assert {:ok, _} = send_msg(a, chat.id, [sealed(sara)])
    refute_envelopes(sara.device)
    assert waiting(sara.device) == 0

    push(a, "typing", %{"chat_id" => chat.id, "typing" => true})
    refute_receive %Message{event: "typing"}, 200

    :ok = Accounts.unblock(sara.user, ali.user.id)
    assert {:ok, _} = send_msg(a, chat.id, [sealed(sara)])
    assert [_] = envelopes_for(sara.device)
  end

  ## Ticks

  test "delivered and read ticks go to the sender", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    online(ali.token, ali.device)
    s = online(sara.token, sara.device)

    for status <- ["delivered", "read"] do
      ref =
        push(s, "receipt", %{
          "chat_id" => chat.id,
          "to" => ali.user.id,
          "status" => status,
          "seqs" => [1, 2]
        })

      assert_reply ref, :ok
      assert [%{kind: "receipt", from: from, data: data}] = envelopes_for(ali.device)
      assert from == sara.user.id
      assert data == %{"status" => status, "seqs" => [1, 2], "to" => ali.user.id}
    end
  end

  test "with read receipts off, no blue ticks either way, but my other devices know", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    sara_web = linked(sara.user)
    {:ok, _} = Accounts.update_profile(sara.user, %{"read_receipts" => false})
    online(ali.token, ali.device)
    s = online(sara.token, sara.device)
    online(sara_web.token, sara_web.device)

    read = %{"chat_id" => chat.id, "to" => ali.user.id, "status" => "read", "seqs" => [1]}
    ref = push(s, "receipt", read)
    assert_reply ref, :ok
    refute_envelopes(ali.device)
    assert [%{data: %{"status" => "read"}}] = envelopes_for(sara_web.device)

    # "Delivered" still goes.
    ref = push(s, "receipt", %{read | "status" => "delivered"})
    assert_reply ref, :ok
    assert [%{data: %{"status" => "delivered"}}] = envelopes_for(ali.device)
  end

  test "receipts only for people in the chat", ctx do
    %{bilal: bilal, ali: ali, chat: chat} = ctx
    b = online(bilal.token, bilal.device)

    ref =
      push(b, "receipt", %{
        "chat_id" => chat.id,
        "to" => ali.user.id,
        "status" => "read",
        "seqs" => [1]
      })

    assert_reply ref, :error, %{reason: :not_found}
  end

  ## Typing

  test "typing goes to the others live and is never saved", ctx do
    %{ali: ali, sara: sara, bilal: bilal, chat: chat} = ctx
    a = online(ali.token, ali.device)
    online(sara.token, sara.device)
    online(bilal.token, bilal.device)

    push(a, "typing", %{"chat_id" => chat.id, "typing" => true})
    sara_topic = "device:" <> sara.device.id

    assert_receive %Message{
      topic: ^sara_topic,
      event: "typing",
      payload: %{typing: true, user_id: id}
    }

    assert id == ali.user.id

    # Not to Bilal (not in the chat), and not to Ali himself.
    bilal_topic = "device:" <> bilal.device.id
    ali_topic = "device:" <> ali.device.id
    refute_receive %Message{topic: ^bilal_topic, event: "typing"}, 100
    refute_receive %Message{topic: ^ali_topic, event: "typing"}, 100
    assert Repo.aggregate(Envelope, :count) == 0
  end

  ## Online and last seen

  defp watch(socket, user) do
    ref = push(socket, "watch", %{"user_id" => user.id})
    assert_reply ref, :ok, presence
    presence
  end

  test "online and last seen, for everyone by default", ctx do
    %{ali: ali, sara: sara} = ctx
    a = online(ali.token, ali.device)
    assert %{online: false, last_seen: nil} = watch(a, sara.user)

    s = online(sara.token, sara.device)
    ali_topic = "device:" <> ali.device.id
    assert_receive %Message{topic: ^ali_topic, event: "presence", payload: %{online: true}}

    offline(s)

    assert_receive %Message{
      topic: ^ali_topic,
      event: "presence",
      payload: %{online: false, last_seen: %DateTime{}}
    }
  end

  test "last seen: nobody", ctx do
    %{ali: ali, sara: sara} = ctx

    {:ok, _} =
      Accounts.update_profile(sara.user, %{
        "last_seen_visibility" => "nobody",
        "online_visibility" => "same"
      })

    Accounts.touch_last_seen(sara.user.id)
    online(sara.token, sara.device)
    a = online(ali.token, ali.device)

    assert %{online: false, last_seen: nil} = watch(a, sara.user)
  end

  test "last seen: my contacts (people I have a chat with)", ctx do
    %{ali: ali, sara: sara, bilal: bilal} = ctx

    {:ok, _} =
      Accounts.update_profile(sara.user, %{
        "last_seen_visibility" => "contacts",
        "online_visibility" => "same"
      })

    Accounts.touch_last_seen(sara.user.id)
    online(sara.token, sara.device)

    # Ali has a chat with Sara; Bilal doesn't.
    a = online(ali.token, ali.device)
    b = online(bilal.token, bilal.device)
    assert %{online: true, last_seen: %DateTime{}} = watch(a, sara.user)
    assert %{online: false, last_seen: nil} = watch(b, sara.user)
  end

  test "online for everyone even when last seen is hidden, unless \"same as last seen\"", ctx do
    %{ali: ali, sara: sara} = ctx

    {:ok, _} =
      Accounts.update_profile(sara.user, %{
        "last_seen_visibility" => "nobody",
        "online_visibility" => "everyone"
      })

    Accounts.touch_last_seen(sara.user.id)
    online(sara.token, sara.device)
    a = online(ali.token, ali.device)
    assert %{online: true, last_seen: nil} = watch(a, sara.user)
  end

  test "if you hide your last seen, you can't see others'", ctx do
    %{ali: ali, sara: sara} = ctx
    {:ok, _} = Accounts.update_profile(ali.user, %{"last_seen_visibility" => "nobody"})
    Accounts.touch_last_seen(sara.user.id)
    a = online(ali.token, ali.device)
    assert %{last_seen: nil} = watch(a, sara.user)
  end

  test "people who blocked each other can't see each other online", ctx do
    %{ali: ali, sara: sara} = ctx
    :ok = Accounts.block(sara.user, ali.user)
    Accounts.touch_last_seen(sara.user.id)
    online(sara.token, sara.device)
    a = online(ali.token, ali.device)
    assert %{online: false, last_seen: nil} = watch(a, sara.user)
  end

  test "a changed setting counts straight away", ctx do
    %{ali: ali, sara: sara} = ctx
    a = online(ali.token, ali.device)
    assert %{online: false} = watch(a, sara.user)

    {:ok, _} =
      Accounts.update_profile(sara.user, %{
        "last_seen_visibility" => "nobody",
        "online_visibility" => "same"
      })

    online(sara.token, sara.device)
    ali_topic = "device:" <> ali.device.id
    assert_receive %Message{topic: ^ali_topic, event: "presence", payload: %{online: false}}
  end

  ## Rate limits

  test "flooding a chat is stopped", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    a = online(ali.token, ali.device)
    # The limit is 100 per 10 seconds, counted in 10-second blocks. If a new
    # block starts halfway through, up to 200 can get through, so send 250.
    replies = for _ <- 1..250, do: send_msg(a, chat.id, [sealed(sara)])
    {sent, _} = Enum.split_while(replies, &match?({:ok, _}, &1))
    assert length(sent) >= 100
    assert {:error, %{reason: :rate_limited}} in replies
  end

  test "Relay.pending only ever shows a device its own envelopes", ctx do
    %{ali: ali, sara: sara, chat: chat} = ctx
    a = online(ali.token, ali.device)
    send_msg(a, chat.id, [sealed(sara)])
    assert Relay.pending(ali.device) == []
    assert [_] = Relay.pending(sara.device)
  end
end
