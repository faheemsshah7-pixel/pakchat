defmodule Pakchat.Files.Cleanup do
  @moduledoc """
  Runs every hour (see `config/config.exs`): deletes files past their 30 days,
  unfinished uploads, and old sign-in codes.
  """
  use Oban.Worker, queue: :default
  require Logger

  @impl Oban.Worker
  def perform(_job) do
    files = Pakchat.Files.delete_expired()
    codes = Pakchat.PhoneCodes.delete_old()
    if files + codes > 0, do: Logger.info("cleanup: deleted #{files} files, #{codes} old codes")
    :ok
  end
end
