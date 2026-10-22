defmodule Pakchat.Push do
  @moduledoc """
  Push alerts: waking a phone whose app is closed.

  The alert has nothing in it, no name and no words. It just tells the app
  "you have something", and the app connects and collects it. For now this
  goes through Google's push service (FCM, see `Pakchat.Push.Fcm`). Apple's
  (APNs) comes with the iPhone app.

  Only real messages wake a phone, never ticks or typing, and never the
  sender's own other devices.
  """
  import Ecto.Query
  alias Pakchat.Accounts.Device
  alias Pakchat.{Presence, Repo}
  alias Pakchat.Push.Notify

  @doc """
  Queues an alert for each device that is offline and has a push token.
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
    |> Enum.reject(fn {id, user_id} ->
      senders[id] == [user_id] or Presence.device_online?(user_id, id)
    end)
    |> Enum.each(fn {id, _} -> %{device_id: id} |> Notify.new() |> Oban.insert() end)
  end
end
