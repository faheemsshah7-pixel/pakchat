defmodule Pakchat.Relay.Cleanup do
  @moduledoc """
  Runs every hour (see `config/config.exs`) and deletes envelopes that
  nobody collected within 30 days.
  """
  use Oban.Worker, queue: :default
  require Logger

  @impl Oban.Worker
  def perform(_job) do
    count = Pakchat.Relay.delete_expired()
    if count > 0, do: Logger.info("cleanup: deleted #{count} old envelopes")
    :ok
  end
end
