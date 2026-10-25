defmodule Pakchat.Presence do
  @moduledoc """
  Who is online right now, using Phoenix Presence.

  Each open device connection registers itself under the topic
  `"presence:<user id>"`. Presence keeps that list right across servers,
  and removes a device the moment its connection drops.
  """
  use Phoenix.Presence, otp_app: :pakchat, pubsub_server: Pakchat.PubSub

  def topic(user_id), do: "presence:" <> user_id

  @doc """
  Is this person online: PakChat on screen on any of their devices? A device
  connected in the background (woken to collect a message) doesn't count.
  """
  def online?(user_id) do
    list(topic(user_id))
    |> Enum.any?(fn {_device, %{metas: metas}} -> Enum.any?(metas, &(&1[:active] != false)) end)
  end

  @doc "Is this one device connected (on screen or not)? Push only wakes a phone that isn't."
  def device_online?(user_id, device_uuid), do: Map.has_key?(list(topic(user_id)), device_uuid)
end
