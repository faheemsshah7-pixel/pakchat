defmodule Pakchat.Push do
  @moduledoc """
  Push alerts: waking a phone whose app is closed.

  The push has nothing in it, no name and no words. It just tells the app
  "you have something"; the app wakes quietly, collects and unlocks the
  message, and shows the alert itself ("Sara: hi"), like WhatsApp. It goes
  through Google's push service (FCM, see `Pakchat.Push.Fcm`). Apple's (APNs)
  comes with the iPhone app.

  A phone that looks connected isn't always: a connection can die without
  saying goodbye (screen off, Wi-Fi asleep), and the server only notices a
  while later. So a connected phone that hasn't collected a message within
  a second gets the push anyway (it was 3 seconds before 31 Oct: too slow).

  Only real messages wake a phone, never ticks or typing, and never the
  sender's own other devices. A call that starts ringing gets a "call" push:
  it goes at once and only lives a minute, so a phone that was off doesn't
  ring for a call that's long over.
  """
  import Ecto.Query
  alias Pakchat.Accounts.Device
  alias Pakchat.{Presence, Repo}
  alias Pakchat.Push.Notify

  # How long a connected phone has to collect a message before it's pushed anyway.
  @grace_ms 1_000

  @doc "How long a connected phone has to collect a message (ms) before it's pushed anyway."
  def grace_ms, do: Application.get_env(:pakchat, :push_grace_ms, @grace_ms)

  @doc """
  Which of these devices a message should wake, split by whether they are
  connected right now: `{connected, offline}`, each a list of device ids.
  Only devices with a push token, and never a device whose only sender is
  its own person (my own messages don't wake my other devices).
  `senders` maps each device id to who sent it something.
  """
  def wakeable(senders) do
    device_ids = Map.keys(senders)

    Repo.all(
      from d in Device,
        where: d.id in ^device_ids and not is_nil(d.push_token),
        select: {d.id, d.user_id}
    )
    |> Enum.reject(fn {id, user_id} -> senders[id] == [user_id] end)
    |> Enum.split_with(fn {id, user_id} -> Presence.device_online?(user_id, id) end)
    |> then(fn {on, off} -> {Enum.map(on, &elem(&1, 0)), Enum.map(off, &elem(&1, 0))} end)
  end

  @doc """
  Queues an alert for each device that has a push token: now if it's offline,
  in a second (only if the message is still waiting then) if it's connected.
  Used for calls. Messages to a connected phone are checked by its own
  connection instead (see `PakchatWeb.DeviceChannel`), which costs nothing
  when the phone collects them, as it nearly always does.
  """
  def wake_offline(senders, opts \\ []) do
    {connected, offline} = wakeable(senders)
    call = opts[:call] == true
    Enum.each(connected, &check_later(&1, call: call))
    Enum.each(offline, &wake(&1, call: call))
  end

  @doc "Push this device now."
  def wake(device_id, opts \\ []) do
    # Always said, true or false: Oban's "unique" check matches on the keys given.
    %{device_id: device_id, call: opts[:call] == true} |> Notify.new() |> Oban.insert()
  end

  @doc "Push this device in a second, but only if it still hasn't collected what came."
  def check_later(device_id, opts \\ []) do
    %{device_id: device_id, if_waiting: true, call: opts[:call] == true}
    |> Notify.new(schedule_in: max(1, div(grace_ms(), 1000)))
    |> Oban.insert()
  end

  @doc """
  Push this device now if something that should wake it is still waiting
  (a connected phone that didn't collect it in time: the connection was dead).
  """
  def wake_if_waiting(device_id, opts \\ []) do
    args = %{device_id: device_id, if_waiting: true, call: false}

    # `since`: the oldest message it's about, when that's older than the job
    # (the database was busy, so queuing it waited).
    args =
      case opts[:since] do
        %DateTime{} = t -> Map.put(args, :since, DateTime.to_unix(t))
        _ -> args
      end

    args |> Notify.new() |> Oban.insert()
  end
end
