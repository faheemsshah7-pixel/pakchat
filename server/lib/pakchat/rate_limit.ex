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

  @doc """
  Counts one go (or `amount`, such as bytes) at `bucket` for `key`. Returns `:ok`,
  or `{:error, :rate_limited}`.
  """
  def hit(bucket, key, amount \\ 1) do
    {limit, window_ms} = Keyword.fetch!(limits(), bucket)
    window = div(System.system_time(:millisecond), window_ms)
    count = :ets.update_counter(@table, {bucket, key, window}, amount, {{bucket, key, window}, 0})
    if count <= limit, do: :ok, else: {:error, :rate_limited}
  end

  defp limits, do: Application.fetch_env!(:pakchat, :rate_limits)

  @distinct __MODULE__.Distinct

  @doc """
  Counts how many different `items` `key` has had at `bucket` in its window
  (seeing the same one again is free). `:ok` while that stays within the limit,
  else `{:error, :rate_limited}` and none of the new ones are counted.
  """
  def distinct(bucket, key, items) do
    {limit, window_ms} = Keyword.fetch!(limits(), bucket)
    window = div(System.system_time(:millisecond), window_ms)
    new = Enum.reject(Enum.uniq(items), &:ets.member(@distinct, {bucket, key, window, &1}))
    seen = :ets.update_counter(@table, {bucket, key, window}, 0, {{bucket, key, window}, 0})

    if seen + length(new) <= limit do
      for item <- new, do: :ets.insert(@distinct, {{bucket, key, window, item}})
      :ets.update_counter(@table, {bucket, key, window}, length(new))
      :ok
    else
      {:error, :rate_limited}
    end
  end

  @doc """
  The key for limits counted per internet address. One IPv6 connection gets a
  whole /64 (billions of addresses), so a /64 counts as one address; IPv4 (also
  when written as IPv6) is per address.
  """
  def ip_key({_, _, _, _} = ip), do: ip |> :inet.ntoa() |> to_string()

  def ip_key({0, 0, 0, 0, 0, 0xFFFF, ab, cd}),
    do: ip_key({div(ab, 256), rem(ab, 256), div(cd, 256), rem(cd, 256)})

  def ip_key({a, b, c, d, _, _, _, _}),
    do: Enum.map_join([a, b, c, d], ":", &Integer.to_string(&1, 16)) <> "::/64"

  def ip_key(other), do: inspect(other)

  @doc """
  A wider block for daily limits on costly things (SMS): an IPv4 /24 or an
  IPv6 /48, so a script hopping between nearby addresses still counts as one.
  """
  def ip_block({a, b, c, _}), do: "#{a}.#{b}.#{c}.0/24"

  def ip_block({0, 0, 0, 0, 0, 0xFFFF, ab, cd}),
    do: ip_block({div(ab, 256), rem(ab, 256), div(cd, 256), rem(cd, 256)})

  def ip_block({a, b, c, _, _, _, _, _}),
    do: Enum.map_join([a, b, c], ":", &Integer.to_string(&1, 16)) <> "::/48"

  def ip_block(other), do: inspect(other)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl GenServer
  def init(nil) do
    :ets.new(@table, [:named_table, :public, :set, write_concurrency: true])
    :ets.new(@distinct, [:named_table, :public, :set, write_concurrency: true])
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
      :ets.select_delete(@distinct, [{{{bucket, :_, :"$1", :_}}, [{:<, :"$1", current}], [true]}])
    end

    schedule()
    {:noreply, state}
  end

  defp schedule, do: Process.send_after(self(), :sweep, 60_000)
end
