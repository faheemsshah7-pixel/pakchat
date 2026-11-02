defmodule PakchatWeb.DeviceChannel do
  @moduledoc """
  One device's channel: everything live goes through here.

  When the device joins, it gets everything that was waiting for it, oldest
  first, then new envelopes the moment they arrive. It can say which chats
  it is already up to date with (`"after"`), so a weak network never makes
  it download the same thing twice.

  From the device:

    * `"send"`    a locked message, see `Pakchat.Relay.send_message/3`
    * `"call"`    a locked call message (ringing, connecting), see `Pakchat.Relay.send_call/3`
    * `"ack"`     `{ids}`: "I have these", so the server deletes them
    * `"sync"`    `{after: {chat_id: N}}`: "I have everything up to N", send the rest
    * `"receipt"` `{chat_id, to, status: "delivered" | "read", seqs}`: the ticks
    * `"typing"`  `{chat_id, typing, audio}`: never saved (`audio`: recording a voice note)
    * `"watch"` / `"unwatch"` `{user_id}`: follow someone's online / last seen
    * `"active"`  `{active}`: the app came on screen (true) or went away (false)

  Joining says `"active"` too. Only a device whose app is on screen makes its
  person "online", like WhatsApp: a phone that woke in the background just to
  collect a message stays offline (and keeps its last seen). Push still sees
  every connected device, so a woken phone isn't woken again.

  To the device: `"envelopes"`, `"typing"` and `"presence"`.
  """
  use PakchatWeb, :channel
  require Logger
  alias Pakchat.{Accounts, Presence, Privacy, Push, RateLimit, Relay}
  alias PakchatWeb.{Params, Wire}

  # Most people one device can follow at once.
  @max_watching 200
  # New envelopes are gathered this long (ms) and pushed together.
  @batch_ms 20
  # How long a connected phone has to collect a live tick before it's saved.
  @live_grace_ms 10_000

  @impl true
  def join("device:" <> id, params, socket) do
    device = socket.assigns.device

    # Only your own device's channel. Nobody can listen in on anyone else's.
    if id == device.id do
      # Even when the server itself is shutting down, run `terminate/2`
      # below, so "last seen" is always saved.
      Process.flag(:trap_exit, true)
      if is_map(params["after"]), do: Relay.ack_upto(device, params["after"])
      send(self(), :after_join)
      # An app too old to say counts as on screen, as before.
      active = params["active"] != false

      {:ok,
       socket
       |> assign(:watching, MapSet.new())
       |> assign(:active, active)
       |> assign(:uncollected, %{})
       |> assign(:outgoing, [])
       |> assign(:outgoing_watch, [])
       |> assign(:live, %{})}
    else
      {:error, %{reason: "not_yours"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    device = socket.assigns.device
    # Listen for new envelopes first, then send what was waiting, so nothing
    # slips through the gap. (Something may come both ways; the app drops
    # an envelope id it has already seen.)
    Phoenix.PubSub.subscribe(Pakchat.PubSub, "relay:" <> device.id)
    Phoenix.PubSub.subscribe(Pakchat.PubSub, "user:" <> device.user_id)

    {:ok, _} =
      Presence.track(self(), Presence.topic(device.user_id), device.id, %{
        active: socket.assigns.active
      })

    send(self(), :pending)
    {:noreply, socket}
  end

  # What was waiting while it was away. If the database is too busy right
  # now, try again in a moment instead of dropping the connection.
  def handle_info(:pending, socket) do
    busy_safe(fn ->
      Accounts.touch_device(socket.assigns.device.id)
      push_pending(socket)
    end) || Process.send_after(self(), :pending, 1_000)

    {:noreply, socket}
  end

  # New envelopes are gathered for a moment and pushed together: a busy group
  # chat (or the ticks for one message from everyone in a group) goes as one
  # push, and the phone answers it with one "ack" instead of one each.
  def handle_info({:envelopes, envelopes}, socket), do: {:noreply, gather(socket, envelopes, [])}

  # Messages that should wake this phone if it doesn't collect them: a
  # connection can be dead without the server knowing yet. Watched here, in
  # memory, so a phone that collects them (nearly always) costs nothing.
  def handle_info({:envelopes, envelopes, watch}, socket),
    do: {:noreply, gather(socket, envelopes, watch)}

  # A tick sent live, not saved (see `Pakchat.Relay.send_receipt/5`). Kept
  # here until the phone says it has it; saved if it doesn't in time.
  def handle_info({:live, envelope}, socket) do
    Process.send_after(self(), {:live_collected?, envelope.id}, @live_grace_ms)
    socket = assign(socket, :live, Map.put(socket.assigns.live, envelope.id, envelope))
    {:noreply, gather(socket, [envelope], [])}
  end

  def handle_info({:live_collected?, id}, socket) do
    case Map.fetch(socket.assigns.live, id) do
      {:ok, envelope} ->
        if busy_safe(fn -> Relay.save_live([envelope]) end) do
          {:noreply, assign(socket, :live, Map.delete(socket.assigns.live, id))}
        else
          Process.send_after(self(), {:live_collected?, id}, 1_000)
          {:noreply, socket}
        end

      :error ->
        {:noreply, socket}
    end
  end

  def handle_info(:flush, socket) do
    %{outgoing: outgoing, outgoing_watch: watch} = socket.assigns
    envelopes = outgoing |> Enum.reverse() |> List.flatten()
    push(socket, "envelopes", %{envelopes: Enum.map(envelopes, &Wire.envelope/1)})
    socket = socket |> assign(:outgoing, []) |> assign(:outgoing_watch, [])

    if watch == [] do
      {:noreply, socket}
    else
      Process.send_after(self(), {:collected?, watch}, Push.grace_ms())
      {:noreply, assign(socket, :uncollected, watching(socket.assigns.uncollected, watch))}
    end
  end

  def handle_info({:collected?, ids}, socket) do
    uncollected = socket.assigns.uncollected
    still = Map.take(uncollected, ids)

    if still == %{} or busy_safe(fn -> wake(socket, still) end) do
      {:noreply, assign(socket, :uncollected, Map.drop(uncollected, ids))}
    else
      # The database is too busy to queue the push right now: ask again shortly
      # (still watched, so a connection closing meanwhile wakes the phone too).
      Process.send_after(self(), {:collected?, Map.keys(still)}, 1_000)
      {:noreply, socket}
    end
  end

  def handle_info({:typing, payload}, socket) do
    push(socket, "typing", payload)
    {:noreply, socket}
  end

  # Someone I follow came online or went offline.
  def handle_info(%Phoenix.Socket.Broadcast{event: "presence_diff", topic: topic}, socket) do
    "presence:" <> user_id = topic
    if MapSet.member?(socket.assigns.watching, user_id), do: push_presence(socket, user_id)
    {:noreply, socket}
  end

  def handle_info(_other, socket), do: {:noreply, socket}

  # When the database is overloaded for a moment, answer "rate_limited" (the
  # app tries again in a few seconds) instead of letting the error drop the
  # whole connection: dropped connections reconnect and add even more load.
  @impl true
  def handle_in(event, payload, socket) do
    do_handle_in(event, payload, socket)
  rescue
    e in DBConnection.ConnectionError ->
      Logger.warning(
        "busy: #{event} not done, the database is overloaded (#{Exception.message(e) |> String.slice(0, 80)})"
      )

      {:reply, {:error, %{reason: "rate_limited"}}, socket}
  end

  defp do_handle_in("send", payload, socket) do
    device = socket.assigns.device

    with :ok <- RateLimit.hit(:send, device.id),
         {:ok, chat_id, params} <- Params.message(payload),
         {:ok, %{seq: seq, sent_at: sent_at}} <- Relay.send_message(device, chat_id, params) do
      {:reply, {:ok, %{seq: seq, sent_at: sent_at}}, socket}
    else
      {:error, {:stale_devices, devices}} ->
        {:reply, {:error, Map.put(devices, :reason, "stale_devices")}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  defp do_handle_in("call", payload, socket) do
    device = socket.assigns.device

    with :ok <- RateLimit.hit(:calls, device.id),
         {:ok, chat_id, params} <- Params.call(payload),
         :ok <- Relay.send_call(device, chat_id, params) do
      {:reply, :ok, socket}
    else
      {:error, reason} -> {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  defp do_handle_in("ack", %{"ids" => ids}, socket) when is_list(ids) do
    Relay.ack(socket.assigns.device, ids)
    socket = assign(socket, :live, Map.drop(socket.assigns.live, ids))
    {:reply, :ok, assign(socket, :uncollected, Map.drop(socket.assigns.uncollected, ids))}
  end

  defp do_handle_in("sync", %{"after" => upto}, socket) when is_map(upto) do
    Relay.ack_upto(socket.assigns.device, upto)
    push_pending(socket)
    {:reply, :ok, socket}
  end

  defp do_handle_in("receipt", %{"chat_id" => chat_id, "to" => to} = p, socket) do
    case Relay.send_receipt(socket.assigns.device, chat_id, to, p["status"], p["seqs"]) do
      :ok -> {:reply, :ok, socket}
      {:error, reason} -> {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  defp do_handle_in("typing", %{"chat_id" => chat_id} = p, socket) do
    Relay.typing(socket.assigns.device, chat_id, p["typing"] == true, p["audio"] == true)
    {:noreply, socket}
  end

  defp do_handle_in("watch", %{"user_id" => user_id}, socket) do
    watching = socket.assigns.watching

    cond do
      MapSet.size(watching) >= @max_watching ->
        {:reply, {:error, %{reason: "too_many"}}, socket}

      viewer_and_owner(socket, user_id) == nil ->
        {:reply, {:error, %{reason: "not_found"}}, socket}

      true ->
        unless MapSet.member?(watching, user_id) do
          Phoenix.PubSub.subscribe(Pakchat.PubSub, Presence.topic(user_id))
        end

        socket = assign(socket, :watching, MapSet.put(watching, user_id))
        {viewer, owner} = viewer_and_owner(socket, user_id)
        {:reply, {:ok, presence(viewer, owner)}, socket}
    end
  end

  defp do_handle_in("unwatch", %{"user_id" => user_id}, socket) do
    Phoenix.PubSub.unsubscribe(Pakchat.PubSub, Presence.topic(user_id))
    {:reply, :ok, assign(socket, :watching, MapSet.delete(socket.assigns.watching, user_id))}
  end

  defp do_handle_in("active", %{"active" => active}, socket) when is_boolean(active) do
    if active == socket.assigns.active do
      {:reply, :ok, socket}
    else
      device = socket.assigns.device

      {:ok, _} =
        Presence.update(self(), Presence.topic(device.user_id), device.id, %{active: active})

      # Leaving the screen is when they were last seen.
      unless active, do: Accounts.touch_last_seen(device.user_id)
      {:reply, :ok, assign(socket, :active, active)}
    end
  end

  defp do_handle_in(_event, _payload, socket) do
    {:reply, {:error, %{reason: "bad_request"}}, socket}
  end

  # The connection closed: remember when they were last seen. Not for a
  # phone that only woke in the background: nobody saw them then.
  @impl true
  def terminate(_reason, socket) do
    # Live ticks it never collected: saved, so it gets them when it's back.
    live = Map.values(socket.assigns[:live] || %{})
    if live != [], do: on_close(fn -> Relay.save_live(live) end)

    # Gone before collecting what came in its last second (or before it was
    # even sent on): wake the phone.
    waiting = watching(socket.assigns[:uncollected] || %{}, socket.assigns[:outgoing_watch] || [])
    if waiting != %{}, do: on_close(fn -> wake(socket, waiting) end)

    device = socket.assigns.device

    on_close(fn ->
      if socket.assigns[:active] != false, do: Accounts.touch_last_seen(device.user_id)
      Accounts.touch_device(device.id)
    end)

    :ok
  end

  # Messages this connection is watching, each with when it started watching.
  defp watching(uncollected, ids) do
    now = DateTime.utc_now()
    Enum.reduce(ids, uncollected, &Map.put_new(&2, &1, now))
  end

  # Push the phone if any of these is still waiting for it.
  defp wake(socket, watched) do
    since = watched |> Map.values() |> Enum.min(DateTime)
    Push.wake_if_waiting(socket.assigns.device.id, since: since)
  end

  # The connection is closing, so there's no later: if the database is too
  # busy right now, keep trying for a while on the side.
  defp on_close(fun) do
    unless busy_safe(fun) do
      Task.start(fn -> retry_busy(fun, 30) end)
    end
  end

  defp retry_busy(_fun, 0), do: :ok

  defp retry_busy(fun, tries) do
    Process.sleep(1_000)
    unless busy_safe(fun), do: retry_busy(fun, tries - 1)
  end

  defp gather(socket, envelopes, watch) do
    if socket.assigns.outgoing == [], do: Process.send_after(self(), :flush, @batch_ms)

    socket
    |> assign(:outgoing, [envelopes | socket.assigns.outgoing])
    |> assign(:outgoing_watch, watch ++ socket.assigns.outgoing_watch)
  end

  # Runs `fun`; false if the database was too busy to answer in time.
  defp busy_safe(fun) do
    fun.()
    true
  rescue
    DBConnection.ConnectionError -> false
  end

  defp push_pending(socket, after_id \\ 0) do
    batch = Relay.pending(socket.assigns.device, after_id)

    if batch != [] do
      push(socket, "envelopes", %{envelopes: Enum.map(batch, &Wire.envelope/1)})
      if length(batch) == 200, do: push_pending(socket, List.last(batch).id)
    end
  end

  defp push_presence(socket, user_id) do
    case viewer_and_owner(socket, user_id) do
      {viewer, owner} -> push(socket, "presence", presence(viewer, owner))
      nil -> :ok
    end
  end

  # Fresh from the database each time, so a changed privacy setting counts at once.
  defp viewer_and_owner(socket, user_id) do
    with %{} = viewer <- Accounts.get_user(socket.assigns.device.user_id),
         %{} = owner <- Accounts.get_user(user_id) do
      {viewer, owner}
    end
  end

  defp presence(viewer, owner) do
    Map.put(Privacy.presence_for(viewer, owner), :user_id, owner.id)
  end
end
