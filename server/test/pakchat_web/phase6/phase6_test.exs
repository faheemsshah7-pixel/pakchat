defmodule PakchatWeb.Phase6Test do
  @moduledoc """
  Phase 6 on the server: call messages (ringing a closed phone, short-lived,
  never numbered), the call relay's passwords, status (who sees it, who can
  write to it, nothing waking anyone), and GIFs through the server.
  """
  # Not async: these tests share Presence and the live connections, and change settings.
  use PakchatWeb.ChannelCase
  use Oban.Testing, repo: Pakchat.Repo

  import Ecto.Query
  import Phoenix.ConnTest
  import Plug.Conn, only: [put_req_header: 3]
  alias Pakchat.{Accounts, Chats, Relay, Repo}
  alias Pakchat.Chats.Chat
  alias Pakchat.Push.{Fcm, Notify}
  alias Pakchat.Relay.Envelope
  alias Phoenix.Socket.Message

  @endpoint PakchatWeb.Endpoint

  setup do
    ali = person("Ali")
    sara = person("Sara")
    bilal = person("Bilal")
    {:ok, chat} = Chats.get_or_create_direct(ali.user, sara.user.id)
    %{ali: ali, sara: sara, bilal: bilal, chat: chat}
  end

  defp sealed(%{user: user, device: device}, text \\ "locked") do
    %{
      "user_id" => user.id,
      "device_id" => device.device_id,
      "type" => 2,
      "body" => Base.encode64(text)
    }
  end

  defp call(socket, chat_id, envelopes, extra \\ %{}) do
    ref =
      push(socket, "call", Map.merge(%{"chat_id" => chat_id, "envelopes" => envelopes}, extra))

    assert_reply ref, status, reply, 1000
    {status, reply}
  end

  defp send_msg(socket, chat_id, envelopes, extra \\ %{}) do
    ref =
      push(socket, "send", Map.merge(%{"chat_id" => chat_id, "envelopes" => envelopes}, extra))

    assert_reply ref, status, reply, 1000
    {status, reply}
  end

  defp envelopes_for(device) do
    topic = "device:" <> device.id
    assert_receive %Message{topic: ^topic, event: "envelopes", payload: %{envelopes: list}}, 1000
    list
  end

  defp refute_envelopes(device) do
    topic = "device:" <> device.id
    refute_receive %Message{topic: ^topic, event: "envelopes"}, 200
  end

  defp as(%{token: token}),
    do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  ## Calls

  describe "call messages" do
    test "reach the other phone at once, with no number, and don't stay long", ctx do
      %{ali: ali, sara: sara, chat: chat} = ctx
      a = online(ali.token, ali.device)
      online(sara.token, sara.device)

      assert {:ok, _} = call(a, chat.id, [sealed(sara, "ring")], %{"ring" => true})
      [env] = envelopes_for(sara.device)
      assert env.kind == "call"
      assert env.seq == nil
      assert Base.decode64!(env.body) == "ring"

      e = Repo.get!(Envelope, env.id)
      assert DateTime.diff(e.expires_at, e.sent_at) == 60
      # The chat's counter didn't move: calls aren't messages.
      assert Repo.get!(Chat, chat.id).seq == 0
    end

    test "ringing wakes a closed phone with a call push; the rest of the call doesn't", ctx do
      %{ali: ali, sara: sara, chat: chat} = ctx
      Accounts.set_push_token(sara.device, %{push_token: "fcm-token", push_platform: "fcm"})
      a = online(ali.token, ali.device)

      assert {:ok, _} = call(a, chat.id, [sealed(sara, "details")])
      assert all_enqueued(worker: Notify) == []

      assert {:ok, _} = call(a, chat.id, [sealed(sara, "ring")], %{"ring" => true})
      assert [job] = all_enqueued(worker: Notify)
      assert job.args == %{"device_id" => sara.device.id, "call" => true}

      # A message push already waiting doesn't swallow the call's, or the other way round.
      send_msg(a, chat.id, [sealed(sara, "hi")])
      assert length(all_enqueued(worker: Notify)) == 2
    end

    test "a connected phone that doesn't pick up the ringing is pushed anyway", ctx do
      %{ali: ali, sara: sara, chat: chat} = ctx
      Accounts.set_push_token(sara.device, %{push_token: "fcm-token", push_platform: "fcm"})
      a = online(ali.token, ali.device)
      online(sara.token, sara.device)
      before = DateTime.add(DateTime.utc_now(), -5, :second)

      call(a, chat.id, [sealed(sara, "ring")], %{"ring" => true})
      [env] = envelopes_for(sara.device)
      assert [job] = all_enqueued(worker: Notify)
      assert job.args == %{"device_id" => sara.device.id, "if_waiting" => true, "call" => true}

      assert Relay.waiting?(sara.device.id, before, "call")
      refute Relay.waiting?(sara.device.id, before)
      Relay.ack(sara.device, [env.id])
      refute Relay.waiting?(sara.device.id, before, "call")
      assert :ok = perform_job(Notify, job.args)
    end

    test "the call push says call, and lives a minute", _ctx do
      assert %{data: %{wake: "1", call: "1"}, android: %{ttl: "60s", priority: "high"}} =
               Fcm.alert(true)

      assert %{data: data, android: %{ttl: "86400s"}} = Fcm.alert(false)
      refute Map.has_key?(data, :call)
    end

    test "an old one is never handed out, even before the clean-up", ctx do
      %{ali: ali, sara: sara, chat: chat} = ctx
      a = online(ali.token, ali.device)
      call(a, chat.id, [sealed(sara, "ring")], %{"ring" => true})

      Repo.update_all(Envelope, set: [expires_at: DateTime.add(DateTime.utc_now(), -1, :second)])
      assert Relay.pending(sara.device) == []
    end

    test "only to people in the chat, and never from someone blocked", ctx do
      %{ali: ali, sara: sara, bilal: bilal, chat: chat} = ctx
      a = online(ali.token, ali.device)
      online(bilal.token, bilal.device)

      # Bilal isn't in the chat: skipped.
      assert {:ok, _} = call(a, chat.id, [sealed(bilal, "ring")], %{"ring" => true})
      refute_envelopes(bilal.device)

      # Not my chat: refused.
      b = online(bilal.token, bilal.device)
      assert {:error, %{reason: :not_found}} = call(b, chat.id, [sealed(sara)])

      # Sara blocked Ali: his ringing never reaches her.
      Accounts.block(sara.user, ali.user)
      online(sara.token, sara.device)
      assert {:ok, _} = call(a, chat.id, [sealed(sara, "ring")], %{"ring" => true})
      refute_envelopes(sara.device)
    end

    test "bad ones are refused", ctx do
      %{ali: ali, sara: sara, chat: chat} = ctx
      a = online(ali.token, ali.device)
      assert {:error, %{reason: :bad_request}} = call(a, chat.id, [])
      assert {:error, %{reason: :bad_request}} = call(a, chat.id, [sealed(sara), sealed(sara)])

      assert {:error, %{reason: :bad_request}} =
               call(a, chat.id, [Map.put(sealed(sara), "type", 7)])
    end

    test "work in groups too", ctx do
      %{ali: ali, sara: sara, bilal: bilal} = ctx

      {:ok, group} =
        Chats.create_group(ali.user, %{"title" => "Study"}, [sara.user.id, bilal.user.id])

      a = online(ali.token, ali.device)
      online(sara.token, sara.device)
      online(bilal.token, bilal.device)
      _ = envelopes_for(sara.device)
      _ = envelopes_for(bilal.device)

      assert {:ok, _} =
               call(a, group.id, [sealed(sara, "s"), sealed(bilal, "b")], %{"ring" => true})

      assert [%{kind: "call"}] = envelopes_for(sara.device)
      assert [%{kind: "call"}] = envelopes_for(bilal.device)
    end
  end

  describe "the call relay" do
    test "STUN only, until a TURN relay is set up", %{ali: ali} do
      Application.delete_env(:pakchat, :turn_urls)
      body = as(ali) |> get("/api/calls/ice") |> json_response(200)
      assert body["ice_servers"] == [%{"urls" => ["stun:stun.l.google.com:19302"]}]
    end

    test "a fresh password for our own coturn, that coturn can check", %{ali: ali} do
      Application.put_env(:pakchat, :turn_urls, ["turn:example.test:3478"])
      Application.put_env(:pakchat, :turn_secret, "shh")

      on_exit(fn ->
        Application.delete_env(:pakchat, :turn_urls)
        Application.delete_env(:pakchat, :turn_secret)
      end)

      %{"ice_servers" => [_stun, turn]} = as(ali) |> get("/api/calls/ice") |> json_response(200)
      assert turn["urls"] == ["turn:example.test:3478"]
      [expiry, user_id] = String.split(turn["username"], ":")
      assert user_id == ali.user.id
      assert String.to_integer(expiry) > System.system_time(:second) + 3600

      assert turn["credential"] ==
               Base.encode64(:crypto.mac(:hmac, :sha, "shh", turn["username"]))
    end

    test "needs sign-in" do
      assert build_conn() |> get("/api/calls/ice") |> json_response(401)
    end
  end

  ## Status

  describe "status" do
    test "only its owner sees who can see it", %{ali: ali, sara: sara, bilal: bilal} do
      body =
        as(ali)
        |> put("/api/status/audience", %{
          "user_ids" => [sara.user.id, bilal.user.id, Ecto.UUID.generate()]
        })
        |> json_response(200)

      assert body["kind"] == "status"

      assert Enum.sort(Enum.map(body["members"], & &1["user_id"])) ==
               Enum.sort([ali.user.id, sara.user.id, bilal.user.id])

      # Sara sees Ali's status chat with just Ali and herself in it.
      chats = as(sara) |> get("/api/chats") |> json_response(200)
      status = Enum.find(chats["chats"], &(&1["kind"] == "status"))

      assert Enum.sort(Enum.map(status["members"], & &1["user_id"])) ==
               Enum.sort([ali.user.id, sara.user.id])

      assert Enum.find(status["members"], &(&1["user_id"] == ali.user.id))["role"] == "admin"

      # The same chat every time; leaving someone out takes them out.
      again =
        as(ali)
        |> put("/api/status/audience", %{"user_ids" => [bilal.user.id]})
        |> json_response(200)

      assert again["id"] == body["id"]

      assert Enum.sort(Enum.map(again["members"], & &1["user_id"])) ==
               Enum.sort([ali.user.id, bilal.user.id])

      assert as(sara) |> get("/api/chats/#{body["id"]}") |> json_response(404)
    end

    test "group changes can't touch it", %{ali: ali, sara: sara} do
      %{"id" => id} =
        as(ali)
        |> put("/api/status/audience", %{"user_ids" => [sara.user.id]})
        |> json_response(200)

      assert as(ali) |> patch("/api/groups/#{id}", %{"title" => "x"}) |> json_response(404)
      assert as(sara) |> delete("/api/groups/#{id}/members/#{sara.user.id}") |> json_response(404)
    end

    test "bad lists are refused", %{ali: ali} do
      assert as(ali)
             |> put("/api/status/audience", %{"user_ids" => "everyone"})
             |> json_response(400)

      assert as(ali) |> put("/api/status/audience", %{"user_ids" => [1]}) |> json_response(400)
    end

    test "only the owner posts; viewers like it to the owner only; nobody is woken", ctx do
      %{ali: ali, sara: sara, bilal: bilal} = ctx
      {:ok, status} = Chats.set_status_audience(ali.user, [sara.user.id, bilal.user.id])

      for p <- [sara, bilal],
          do: Accounts.set_push_token(p.device, %{push_token: "t", push_platform: "fcm"})

      a = online(ali.token, ali.device)
      s = online(sara.token, sara.device)
      online(bilal.token, bilal.device)

      group = %{"type" => 7, "body" => Base.encode64("a photo")}
      assert {:ok, %{seq: 1}} = send_msg(a, status.id, [], %{"group" => group})
      assert [%{kind: "message", seq: 1}] = envelopes_for(sara.device)
      assert [%{kind: "message"}] = envelopes_for(bilal.device)
      assert all_enqueued(worker: Notify) == []

      e = Repo.one!(from e in Envelope, where: e.device_id == ^sara.device.id, limit: 1)
      assert DateTime.diff(e.expires_at, e.sent_at, :hour) == 24

      # Sara can't post to Ali's status, or send anything to Bilal through it.
      assert {:error, %{reason: :forbidden}} = send_msg(s, status.id, [], %{"group" => group})
      assert {:error, %{reason: :forbidden}} = send_msg(s, status.id, [sealed(ali)])

      assert {:error, %{reason: :forbidden}} =
               send_msg(s, status.id, [sealed(bilal)], %{"kind" => "reaction"})

      # A like goes to Ali alone.
      assert {:ok, _} = send_msg(s, status.id, [sealed(ali, "like")], %{"kind" => "reaction"})
      assert [%{kind: "reaction"}] = envelopes_for(ali.device)
      refute_envelopes(bilal.device)

      # "Seen" goes to Ali.
      ref =
        push(s, "receipt", %{
          "chat_id" => status.id,
          "to" => ali.user.id,
          "status" => "read",
          "seqs" => [1]
        })

      assert_reply ref, :ok
      assert [%{kind: "receipt"}] = envelopes_for(ali.device)

      # No calls in a status.
      assert {:error, %{reason: :bad_request}} = call(a, status.id, [sealed(sara)])
    end
  end

  ## GIFs

  describe "GIFs" do
    setup do
      on_exit(fn ->
        Application.delete_env(:pakchat, :klipy_key)
        Application.delete_env(:pakchat, :klipy_req)
      end)
    end

    test "hidden without a key", %{ali: ali} do
      Application.delete_env(:pakchat, :klipy_key)
      assert as(ali) |> get("/api/gifs") |> json_response(404)
    end

    test "searches through the server, passing on only KLIPY's addresses", %{ali: ali} do
      me = self()
      Application.put_env(:pakchat, :klipy_key, "k")

      Application.put_env(:pakchat, :klipy_req, fn url, query ->
        send(me, {:asked, url, query})

        {:ok,
         %{
           status: 200,
           body: %{
             "next" => "30",
             "results" => [
               %{
                 "id" => 1,
                 "media_formats" => %{
                   "mp4" => %{"url" => "https://static.klipy.com/a.mp4", "dims" => [320, 240]},
                   "tinygif" => %{"url" => "https://static.klipy.com/a.gif", "dims" => [160, 120]}
                 }
               },
               %{
                 "id" => 2,
                 "media_formats" => %{
                   "mp4" => %{"url" => "https://evil.example/b.mp4"},
                   "tinygif" => %{"url" => "https://static.klipy.com/b.gif"}
                 }
               },
               "junk"
             ]
           }
         }}
      end)

      body = as(ali) |> get("/api/gifs?q=eid&lang=ur") |> json_response(200)

      assert body == %{
               "gifs" => [
                 %{
                   "id" => "1",
                   "mp4" => "https://static.klipy.com/a.mp4",
                   "preview" => "https://static.klipy.com/a.gif",
                   "width" => 320,
                   "height" => 240
                 }
               ],
               "next" => "30"
             }

      assert_received {:asked, "https://api.klipy.com/v2/search", query}
      assert query[:q] == "eid"
      assert query[:key] == "k"
      assert query[:locale] == "ur_PK"
      assert query[:contentfilter] == "medium"

      as(ali) |> get("/api/gifs?pos=30") |> json_response(200)
      assert_received {:asked, "https://api.klipy.com/v2/featured", query}
      assert query[:pos] == "30"
      refute Keyword.has_key?(query, :q)
    end

    test "KLIPY down: a clear answer", %{ali: ali} do
      Application.put_env(:pakchat, :klipy_key, "k")
      Application.put_env(:pakchat, :klipy_req, fn _, _ -> {:error, :timeout} end)
      assert as(ali) |> get("/api/gifs") |> json_response(503)
    end
  end
end
