defmodule Pakchat.Push.Notify do
  @moduledoc """
  The background job that sends one push alert.

  `unique` means: if this device already has an alert queued in the last
  30 seconds, don't queue another. Ten messages in a row wake it once.
  """
  use Oban.Worker, queue: :push, max_attempts: 5, unique: [period: 30, keys: [:device_id]]
  require Logger

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"device_id" => device_id}}) do
    case Pakchat.Accounts.get_device(device_id) do
      %{push_token: token, push_platform: platform} when is_binary(token) ->
        # Phase 5: send it to FCM or APNs here.
        Logger.info("push (stub): would wake device #{device_id} via #{platform}")
        :ok

      _ ->
        # Signed out, or no token any more. Nothing to do.
        :ok
    end
  end
end
