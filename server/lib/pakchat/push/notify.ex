defmodule Pakchat.Push.Notify do
  @moduledoc """
  The background job that sends one push alert.

  `unique` means: if this device already has an alert queued in the last
  30 seconds, don't queue another. Ten messages in a row wake it once.
  """
  use Oban.Worker, queue: :push, max_attempts: 5, unique: [period: 30, keys: [:device_id]]
  require Logger
  alias Pakchat.Accounts
  alias Pakchat.Push.Fcm

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"device_id" => device_id}}) do
    case Accounts.get_device(device_id) do
      %{push_token: token, push_platform: "fcm"} = device when is_binary(token) ->
        if Fcm.configured?() do
          send_fcm(device, token)
        else
          Logger.info("push: FCM_SERVICE_ACCOUNT isn't set, so no alert for device #{device_id}")
          :ok
        end

      _ ->
        # Signed out, no token any more, or iPhone (later). Nothing to do.
        :ok
    end
  end

  defp send_fcm(device, token) do
    case Fcm.send(token) do
      :gone ->
        # The app was removed or its token changed: stop using this one.
        Accounts.set_push_token(device, %{push_token: nil, push_platform: nil})
        :ok

      other ->
        other
    end
  end
end
