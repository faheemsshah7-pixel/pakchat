defmodule Pakchat.Relay do
  @moduledoc """
  The heart of the server: it passes locked messages along and forgets them.

  1. A device sends a message, already locked separately for each device
     that should get it (the other person's, and the sender's own others).
  2. The chat's counter gives it the next number (`seq`).
  3. One envelope per device is saved in `pending_envelopes` and pushed
     straight away to devices that are online. Offline ones get a push
     alert with nothing in it, which wakes the app up to collect.
  4. When a device says it has an envelope (`ack`), it is deleted.
     Anything never collected is deleted after 30 days.
  """
  import Ecto.Query
  alias Pakchat.Accounts
  alias Pakchat.Accounts.{Block, Device, User}
  alias Pakchat.Chats
  alias Pakchat.Chats.Chat
  alias Pakchat.Push
  alias Pakchat.Relay.Envelope
  alias Pakchat.Repo

  @keep_for_days 30
  # Locked text is small. Photos and files go to file storage (phase 5).
  @max_body 64 * 1024
  # Signal's message types: 2 normal, 3 the first one (starts a session),
  # 7 a group message (sender key), 8 a plain "please resend" notice.
  @signal_types [2, 3, 7, 8]

  ## Sending

  @doc """
  Sends one message to a chat.

  `params`:
    * `kind`: "message", or "reaction" (reactions are still allowed when only
      admins can send, as in today's app), or "control".
    * `envelopes`: `[%{user_id, device_id, type, body}]`, locked for one device each.
    * `group`: `%{type, body}`, locked once with the sender's group key and
      copied to every device in the group. Groups only.
    * `devices`: groups only, optional. `[%{user_id, device_id}]`: every device
      the sender thinks is in the group. If that's out of date, the reply is
      `stale_devices`, so the sender learns about a new phone or website.

  For a one-to-one chat the sender must cover every device exactly. If the
  list is out of date (someone linked a new device), it gets back
  `{:stale_devices, %{missing, extra}}`, fetches the new keys and tries again.

  "control" is the app's own housekeeping, for just a few devices: "I can't
  open your message, please send it again", or a group key. It needs no group
  copy and doesn't have to cover every device, and anyone in the chat may send
  it, even when only admins can send. Each app checks what's inside.
  """
  def send_message(%Device{} = sender, chat_id, params) do
    kind = params[:kind] || "message"
    envelopes = params[:envelopes] || []
    group = params[:group]

    with {:ok, chat} <- member_chat(sender.user_id, chat_id),
         :ok <- validate(kind, envelopes, group),
         :ok <- may_send(chat, sender.user_id, kind),
         devices = recipients(chat.id, sender),
         :ok <- check_devices(chat, kind, devices, envelopes, group, params[:devices]) do
      # In a one-to-one chat, someone who blocked you never gets your
      # messages. You aren't told, as in WhatsApp: it just stays on one tick.
      blocked = blocked_by(chat, sender.user_id)
      now = DateTime.utc_now()

      {:ok, {seq, stored}} =
        Repo.transaction(fn ->
          seq = Chats.next_seq(chat.id)
          base = base_row(chat.id, seq, sender, kind, now)

          rows =
            direct_rows(base, envelopes, devices, blocked) ++
              group_rows(base, group, devices, blocked)

          {seq, insert(rows)}
        end)

      deliver(stored)
      {:ok, %{seq: seq, sent_at: now}}
    end
  end

  # One row for each envelope locked for one device.
  defp direct_rows(base, envelopes, devices, blocked) do
    uuid = Map.new(devices, fn {user, dev, id} -> {{user, dev}, id} end)

    for e <- envelopes, e.user_id not in blocked do
      Map.merge(base, %{device_id: uuid[{e.user_id, e.device_id}], type: e.type, body: e.body})
    end
  end

  # The group message, copied once for every device in the group.
  defp group_rows(_base, nil, _devices, _blocked), do: []

  defp group_rows(base, group, devices, blocked) do
    for {user, _dev, id} <- devices, user not in blocked do
      Map.merge(base, %{device_id: id, type: group.type, body: group.body})
    end
  end

  # The kinds a device may send. A control message ("please send that
  # again", a resend) goes to named devices only, never as a group copy.
  defp valid_kind("control", envelopes, group), do: group == nil and envelopes != []
  defp valid_kind(kind, _envelopes, _group), do: kind in ["message", "reaction"]

  defp validate(kind, envelopes, group) do
    sealed = if group, do: [group | envelopes], else: envelopes
    targets = Enum.map(envelopes, &{&1.user_id, &1.device_id})

    cond do
      not valid_kind(kind, envelopes, group) -> {:error, :bad_request}
      Enum.any?(sealed, &(byte_size(&1.body) > @max_body)) -> {:error, :too_big}
      Enum.any?(sealed, &(&1.type not in @signal_types)) -> {:error, :bad_request}
      length(Enum.uniq(targets)) != length(targets) -> {:error, :bad_request}
      true -> :ok
    end
  end

  # "Only admins can send messages": everyone else can still react.
  defp may_send(%Chat{only_admins_send: true} = chat, user_id, "message") do
    if Chats.role(chat.id, user_id) == "admin", do: :ok, else: {:error, :admins_only}
  end

  defp may_send(_chat, _user_id, _kind), do: :ok

  # Every device in the chat except the one sending.
  defp recipients(chat_id, sender) do
    Chats.member_devices(chat_id)
    |> Enum.reject(fn {_user, _dev, id} -> id == sender.id end)
  end

  # A one-to-one message has no group copy. A group message needs something to send.
  defp check_devices(%Chat{kind: "direct"}, _kind, _devices, _envelopes, group, _known)
       when group != nil,
       do: {:error, :bad_request}

  defp check_devices(%Chat{kind: "group"}, _kind, _devices, [], nil, _known),
    do: {:error, :bad_request}

  defp check_devices(chat, kind, devices, envelopes, _group, known) do
    expected = MapSet.new(devices, fn {user, dev, _} -> {user, dev} end)
    given = MapSet.new(envelopes, &{&1.user_id, &1.device_id})
    extra = MapSet.difference(given, expected)

    # What the sender should have covered: every device for a one-to-one
    # message, the devices it named for a group (if it named any).
    missing =
      cond do
        kind == "control" -> MapSet.new()
        chat.kind == "direct" -> MapSet.difference(expected, given)
        is_list(known) -> MapSet.difference(expected, MapSet.new(known))
        true -> MapSet.new()
      end

    # A group device the sender named that isn't there any more.
    extra =
      if chat.kind == "group" and is_list(known) and kind != "control",
        do: MapSet.union(extra, MapSet.difference(MapSet.new(known), expected)),
        else: extra

    if MapSet.size(missing) + MapSet.size(extra) > 0, do: stale(missing, extra), else: :ok
  end

  defp stale(missing, extra) do
    list = fn set -> Enum.map(set, fn {user, dev} -> %{user_id: user, device_id: dev} end) end
    {:error, {:stale_devices, %{missing: list.(missing), extra: list.(extra)}}}
  end

  defp blocked_by(%Chat{kind: "direct"} = chat, sender_id) do
    Accounts.blocked_by(sender_id, Chats.member_ids(chat.id))
  end

  defp blocked_by(_chat, _sender_id), do: []

  ## Receipts (the ticks)

  @doc """
  Tells `to_user_id` that their messages `seqs` were delivered or read.

  Receipts carry no words, only numbers. "read" receipts in a one-to-one
  chat follow the read receipts setting: if either person has turned it
  off, the other doesn't get them (as in WhatsApp). The reader's own other
  devices always hear about "read", so they can clear the unread count.
  """
  def send_receipt(%Device{} = sender, chat_id, to_user_id, status, seqs)
      when status in ["delivered", "read"] do
    with :ok <- check_seqs(seqs),
         {:ok, chat} <- member_chat(sender.user_id, chat_id),
         {:ok, _} <- member_chat(to_user_id, chat.id) do
      them? = receipt_allowed?(chat, sender.user_id, to_user_id, status)

      targets =
        recipients(chat.id, sender)
        |> Enum.filter(fn {user, _, _} ->
          (user == to_user_id and them?) or (user == sender.user_id and status == "read")
        end)

      body = Jason.encode!(%{status: status, seqs: seqs, to: to_user_id})
      base = base_row(chat.id, nil, sender, "receipt", DateTime.utc_now())

      targets
      |> Enum.map(fn {_, _, id} -> Map.merge(base, %{device_id: id, type: 0, body: body}) end)
      |> insert()
      |> deliver()
    end
  end

  def send_receipt(_sender, _chat_id, _to, _status, _seqs), do: {:error, :bad_request}

  defp check_seqs(seqs) when is_list(seqs) and seqs != [] and length(seqs) <= 500 do
    if Enum.all?(seqs, &is_integer/1), do: :ok, else: {:error, :bad_request}
  end

  defp check_seqs(_), do: {:error, :bad_request}

  # Does the other person get this receipt? Not if it's to myself, not if
  # either of us blocked the other, and "read" only if read receipts allow it.
  defp receipt_allowed?(chat, from, to, status) do
    from != to and not Accounts.blocked_between?(from, to) and
      (status == "delivered" or read_receipts_allowed?(chat, from, to))
  end

  defp read_receipts_allowed?(%Chat{kind: "group"}, _a, _b), do: true

  defp read_receipts_allowed?(_chat, a, b) do
    Repo.aggregate(from(u in User, where: u.id in ^[a, b] and u.read_receipts), :count) ==
      length(Enum.uniq([a, b]))
  end

  ## Group notes

  @doc """
  Saves a group note ("Ali added Sara") for every member's devices, plus
  `extra_user_ids` (someone just removed). Call inside a transaction, then
  pass the result to `deliver/1` once it is saved.
  """
  def store_system_note(chat_id, actor_id, data, extra_user_ids \\ []) do
    seq = Chats.next_seq(chat_id)
    now = DateTime.utc_now()
    body = Jason.encode!(Map.put(data, :by, actor_id))

    member_devices = Chats.member_devices(chat_id) |> Enum.map(fn {_, _, id} -> id end)

    extra_devices =
      Repo.all(from d in Device, where: d.user_id in ^extra_user_ids, select: d.id)

    (member_devices ++ extra_devices)
    |> Enum.uniq()
    |> Enum.map(fn id ->
      %{
        device_id: id,
        chat_id: chat_id,
        seq: seq,
        sender_id: actor_id,
        sender_device: nil,
        kind: "system",
        type: 0,
        body: body,
        sent_at: now,
        expires_at: expiry(now)
      }
    end)
    |> insert()
  end

  ## Typing

  @doc """
  "Typing…" goes straight to the others' open connections and is never
  saved. People who blocked each other don't see it.
  """
  def typing(%Device{} = sender, chat_id, typing?) do
    with {:ok, chat} <- member_chat(sender.user_id, chat_id) do
      blocked =
        Accounts.blocked_by(sender.user_id, Chats.member_ids(chat.id)) ++
          blocked_by_me(sender.user_id)

      for user_id <- Chats.member_ids(chat.id),
          user_id != sender.user_id,
          user_id not in blocked do
        Phoenix.PubSub.broadcast(
          Pakchat.PubSub,
          "user:" <> user_id,
          {:typing, %{chat_id: chat.id, user_id: sender.user_id, typing: typing? == true}}
        )
      end

      :ok
    end
  end

  defp blocked_by_me(user_id) do
    Repo.all(from b in Block, where: b.blocker_id == ^user_id, select: b.blocked_id)
  end

  ## Collecting

  @doc "True if a message sent since `since` is still waiting for this device (it hasn't collected it)."
  def waiting?(device_id, %DateTime{} = since) do
    Repo.exists?(
      from e in Envelope,
        where: e.device_id == ^device_id and e.kind == "message" and e.sent_at >= ^since
    )
  end

  @doc "Envelopes waiting for this device, oldest first, after envelope `after_id`."
  def pending(%Device{id: device_id}, after_id \\ 0, limit \\ 200) do
    Repo.all(
      from e in Envelope,
        where: e.device_id == ^device_id and e.id > ^after_id,
        order_by: e.id,
        limit: ^limit
    )
  end

  @doc "The device has these envelopes, so they are deleted. Only its own, of course."
  def ack(%Device{id: device_id}, ids) when is_list(ids) do
    ids = Enum.filter(ids, &is_integer/1)

    {count, _} =
      Repo.delete_all(from e in Envelope, where: e.device_id == ^device_id and e.id in ^ids)

    count
  end

  @doc """
  "I already have everything up to number N in this chat": deletes those.
  `upto` is a map of chat id to N. Used when reconnecting on a weak network.
  """
  def ack_upto(%Device{id: device_id}, upto) when is_map(upto) do
    Enum.reduce(upto, 0, fn {chat_id, n}, total ->
      case Ecto.UUID.cast(chat_id) do
        {:ok, chat_id} when is_integer(n) ->
          {count, _} =
            Repo.delete_all(
              from e in Envelope,
                where: e.device_id == ^device_id and e.chat_id == ^chat_id and e.seq <= ^n
            )

          total + count

        _ ->
          total
      end
    end)
  end

  @doc "Deletes everything older than 30 days. Run every hour by `Pakchat.Relay.Cleanup`."
  def delete_expired do
    {count, _} =
      Repo.delete_all(from e in Envelope, where: e.expires_at < ^DateTime.utc_now())

    count
  end

  ## Delivering

  @doc """
  Pushes saved envelopes to the devices that are online, and wakes the ones
  that aren't with an empty push alert.
  """
  def deliver([]), do: :ok

  def deliver(envelopes) do
    by_device = Enum.group_by(envelopes, & &1.device_id)

    for {device_id, list} <- by_device do
      Phoenix.PubSub.broadcast(Pakchat.PubSub, "relay:" <> device_id, {:envelopes, list})
    end

    # Only messages wake a closed app: not ticks, reactions or group notes.
    by_device
    |> Enum.map(fn {id, list} ->
      {id, for(e <- list, e.kind == "message", uniq: true, do: e.sender_id)}
    end)
    |> Enum.reject(fn {_id, senders} -> senders == [] end)
    |> Map.new()
    |> Push.wake_offline()

    :ok
  end

  ## Helpers

  defp member_chat(user_id, chat_id) do
    with {:ok, uuid} <- Ecto.UUID.cast(chat_id),
         {:ok, user_id} <- Ecto.UUID.cast(user_id),
         role when role != nil <- Chats.role(uuid, user_id) do
      {:ok, Repo.get!(Chat, uuid)}
    else
      _ -> {:error, :not_found}
    end
  end

  defp base_row(chat_id, seq, sender, kind, now) do
    %{
      chat_id: chat_id,
      seq: seq,
      sender_id: sender.user_id,
      sender_device: sender.device_id,
      kind: kind,
      sent_at: now,
      expires_at: expiry(now)
    }
  end

  defp expiry(now), do: DateTime.add(now, @keep_for_days, :day)

  # Saves rows in batches (Postgres takes a limited number at once), oldest first.
  defp insert(rows) do
    rows
    |> Enum.chunk_every(1000)
    |> Enum.flat_map(fn chunk ->
      {_, saved} = Repo.insert_all(Envelope, chunk, returning: true)
      saved
    end)
  end
end
