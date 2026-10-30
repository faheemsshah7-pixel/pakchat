defmodule Pakchat.Push.Notify do
  @moduledoc """
  The background job that sends one push alert.

  `unique` means: while this device already has a push waiting to go, don't
  queue another. Ten messages in a row wake it once, and it collects all ten.
  Once that push has gone, the next message gets its own.

  `if_waiting`: the phone looked connected, so only push if it still hasn't
  collected anything (see `Pakchat.Push`).

  `call`: a call is ringing. It's queued apart from message pushes (a waiting
  message push mustn't swallow it), and the push says "call", so the phone
  knows to ring.
  """
  use Oban.Worker,
    queue: :push,
    max_attempts: 5,
    unique: [period: 60, keys: [:device_id, :call], states: [:available, :scheduled]]

  require Logger
  alias Pakchat.{Accounts, Relay}
  alias Pakchat.Push.Fcm

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"device_id" => device_id} = args} = job) do
    case Accounts.get_device(device_id) do
      %{push_token: token} when is_binary(token) and is_map_key(args, "if_waiting") ->
        # Only messages from about when this was queued: an old one that's
        # stuck shouldn't wake the phone again and again.
        since = DateTime.add(job.inserted_at || DateTime.utc_now(), -5, :second)
        # (A like on a status wakes the phone too, see `Relay.send_message/3`.)
        kind = if args["call"], do: "call", else: ["message", "reaction"]

        if Relay.waiting?(device_id, since, kind),
          do: perform(%Oban.Job{args: Map.delete(args, "if_waiting")}),
          else: :ok

      %{push_token: token, push_platform: "fcm"} = device when is_binary(token) ->
        if Fcm.configured?() do
          send_fcm(device, token, args["call"] == true)
        else
          Logger.info("push: FCM_SERVICE_ACCOUNT isn't set, so no alert for device #{device_id}")
          :ok
        end

      _ ->
        # Signed out, no token any more, or iPhone (later). Nothing to do.
        :ok
    end
  end

  defp send_fcm(device, token, call?) do
    case Fcm.send(token, call: call?) do
      :gone ->
        # The app was removed or its token changed: stop using this one.
        Accounts.set_push_token(device, %{push_token: nil, push_platform: nil})
        :ok

      other ->
        other
    end
  end
end
