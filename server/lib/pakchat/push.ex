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
  3 seconds gets the push anyway.

  Only real messages wake a phone, never ticks or typing, and never the
  sender's own other devices.
  """
  import Ecto.Query
  alias Pakchat.Accounts.Device
  alias Pakchat.{Presence, Repo}
  alias Pakchat.Push.Notify

  # How long a connected phone has to collect a message before it's pushed anyway.
  @grace_seconds 3

  @doc """
  Queues an alert for each device that has a push token: now if it's offline,
  in 3 seconds (only if the message is still waiting then) if it's connected.
  `senders` maps each device id to who sent it something, so a person's own
  messages don't wake their own other devices.
  """
  def wake_offline(senders) do
    device_ids = Map.keys(senders)

    Repo.all(
      from d in Device,
        where: d.id in ^device_ids and not is_nil(d.push_token),
        select: {d.id, d.user_id}
    )
    |> Enum.reject(fn {id, user_id} -> senders[id] == [user_id] end)
    |> Enum.each(fn {id, user_id} ->
      if Presence.device_online?(user_id, id) do
        %{device_id: id, if_waiting: true}
        |> Notify.new(schedule_in: @grace_seconds)
        |> Oban.insert()
      else
        %{device_id: id} |> Notify.new() |> Oban.insert()
      end
    end)
  end
end
