defmodule Pakchat.RateLimit do
  @moduledoc """
  Stops anyone doing something too often, such as looking up hundreds of
  Gmail addresses or flooding a chat.

  Each kind of action has a limit, like "30 per minute" (see
  `config/config.exs`). We count in a fast in-memory table (ETS), in
  one-minute (or whatever the window is) blocks, and clear old blocks
  every minute.
  """
  use GenServer

  @table __MODULE__

  @doc "Counts one go at `bucket` for `key`. Returns `:ok`, or `{:error, :rate_limited}`."
  def hit(bucket, key) do
    {limit, window_ms} = Keyword.fetch!(limits(), bucket)
    window = div(System.system_time(:millisecond), window_ms)
    count = :ets.update_counter(@table, {bucket, key, window}, 1, {{bucket, key, window}, 0})
    if count <= limit, do: :ok, else: {:error, :rate_limited}
  end

  defp limits, do: Application.fetch_env!(:pakchat, :rate_limits)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl GenServer
  def init(nil) do
    :ets.new(@table, [:named_table, :public, :set, write_concurrency: true])
    schedule()
    {:ok, nil}
  end

  @impl GenServer
  def handle_info(:sweep, state) do
    now = System.system_time(:millisecond)

    for {bucket, {_limit, window_ms}} <- limits() do
      current = div(now, window_ms)
      # Deletes this bucket's counts from blocks that have ended.
      :ets.select_delete(@table, [{{{bucket, :_, :"$1"}, :_}, [{:<, :"$1", current}], [true]}])
    end

    schedule()
    {:noreply, state}
  end

  defp schedule, do: Process.send_after(self(), :sweep, 60_000)
end
