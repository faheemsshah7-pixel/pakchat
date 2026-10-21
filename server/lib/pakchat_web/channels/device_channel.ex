defmodule PakchatWeb.DeviceChannel do
  @moduledoc """
  One device's channel: everything live goes through here.

  When the device joins, it gets everything that was waiting for it, oldest
  first, then new envelopes the moment they arrive. It can say which chats
  it is already up to date with (`"after"`), so a weak network never makes
  it download the same thing twice.

  From the device:

    * `"send"`    a locked message, see `Pakchat.Relay.send_message/3`
    * `"ack"`     `{ids}`: "I have these", so the server deletes them
    * `"sync"`    `{after: {chat_id: N}}`: "I have everything up to N", send the rest
    * `"receipt"` `{chat_id, to, status: "delivered" | "read", seqs}`: the ticks
    * `"typing"`  `{chat_id, typing}`: never saved
    * `"watch"` / `"unwatch"` `{user_id}`: follow someone's online / last seen

  To the device: `"envelopes"`, `"typing"` and `"presence"`.
  """
  use PakchatWeb, :channel
  alias Pakchat.{Accounts, Presence, Privacy, RateLimit, Relay}
  alias PakchatWeb.{Params, Wire}

  # Most people one device can follow at once.
  @max_watching 200

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
      {:ok, assign(socket, :watching, MapSet.new())}
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
    {:ok, _} = Presence.track(self(), Presence.topic(device.user_id), device.id, %{})
    push_pending(socket)
    {:noreply, socket}
  end

  def handle_info({:envelopes, envelopes}, socket) do
    push(socket, "envelopes", %{envelopes: Enum.map(envelopes, &Wire.envelope/1)})
    {:noreply, socket}
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

  @impl true
  def handle_in("send", payload, socket) do
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

  def handle_in("ack", %{"ids" => ids}, socket) when is_list(ids) do
    Relay.ack(socket.assigns.device, ids)
    {:reply, :ok, socket}
  end

  def handle_in("sync", %{"after" => upto}, socket) when is_map(upto) do
    Relay.ack_upto(socket.assigns.device, upto)
    push_pending(socket)
    {:reply, :ok, socket}
  end

  def handle_in("receipt", %{"chat_id" => chat_id, "to" => to} = p, socket) do
    case Relay.send_receipt(socket.assigns.device, chat_id, to, p["status"], p["seqs"]) do
      :ok -> {:reply, :ok, socket}
      {:error, reason} -> {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  def handle_in("typing", %{"chat_id" => chat_id} = p, socket) do
    Relay.typing(socket.assigns.device, chat_id, p["typing"] == true)
    {:noreply, socket}
  end

  def handle_in("watch", %{"user_id" => user_id}, socket) do
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

  def handle_in("unwatch", %{"user_id" => user_id}, socket) do
    Phoenix.PubSub.unsubscribe(Pakchat.PubSub, Presence.topic(user_id))
    {:reply, :ok, assign(socket, :watching, MapSet.delete(socket.assigns.watching, user_id))}
  end

  def handle_in(_event, _payload, socket) do
    {:reply, {:error, %{reason: "bad_request"}}, socket}
  end

  # The connection closed: remember when they were last seen.
  @impl true
  def terminate(_reason, socket) do
    Accounts.touch_last_seen(socket.assigns.device.user_id)
    :ok
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
