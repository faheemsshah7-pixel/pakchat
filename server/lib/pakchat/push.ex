defmodule Pakchat.Push do
  @moduledoc """
  Push alerts: waking a phone whose app is closed.

  The alert has nothing in it, no name and no words. It just tells the app
  "you have something", and the app connects and collects it. For now this
  is a stub that only writes a line in the log. Phase 5 sends real alerts
  through Google's (FCM) and Apple's (APNs) push services.
  """
  import Ecto.Query
  alias Pakchat.Accounts.Device
  alias Pakchat.{Presence, Repo}
  alias Pakchat.Push.Notify

  @doc "Queues an alert for each of these devices that is offline and has a push token."
  def wake_offline(device_ids) do
    Repo.all(
      from d in Device,
        where: d.id in ^device_ids and not is_nil(d.push_token),
        select: {d.id, d.user_id}
    )
    |> Enum.reject(fn {id, user_id} -> Presence.device_online?(user_id, id) end)
    |> Enum.each(fn {id, _} -> %{device_id: id} |> Notify.new() |> Oban.insert() end)
  end
end
