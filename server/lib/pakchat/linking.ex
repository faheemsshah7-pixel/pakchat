defmodule Pakchat.Linking do
  @moduledoc """
  Linking a website to a phone with a QR code (like WhatsApp Web).

  1. The website makes its own Signal keys and sends their public halves to
     `POST /api/link`. We keep them here, in memory, for a few minutes, and
     give back a private `id` and `secret` plus a short-lived `code`.
  2. The website shows the code in a QR, with a public key of its own that
     we never see, and waits on the `"link:<id>"` channel.
  3. The phone scans the QR, checks the website's identity key against the
     QR, and approves with `POST /api/link/:code`, sending a `provision`
     locked to the QR's key (only the website can open it).
  4. We add the website as a linked device and send it its session token
     and the provision over the channel.

  A code lasts 60 seconds, the ones after it 20 seconds, and a website can
  get 6 codes. After that it shows "Click to reload QR code" and starts over.
  Nothing here is saved to the database until the phone approves.
  """
  use GenServer

  @table __MODULE__
  @first_code_ms 60_000
  @next_code_ms 20_000
  @max_codes 6
  # How long a linked result waits for a website that lost its connection.
  @keep_result_ms 60_000

  @doc """
  Starts a link request for a website's keys. Returns
  `%{id, secret, code, expires_in}` (seconds).
  """
  def start(device_attrs, keys) do
    id = random(16)
    secret = random(32)
    code = random(16)
    now = now()

    request = %{
      secret_hash: hash(secret),
      code: code,
      codes: 1,
      code_expires: now + @first_code_ms,
      # However the website asks for codes, the request ends by then.
      ends: now + @first_code_ms + (@max_codes - 1) * @next_code_ms + 30_000,
      device: device_attrs,
      keys: keys,
      result: nil
    }

    :ets.insert(@table, [{{:id, id}, request}, {{:code, code}, id}])
    %{id: id, secret: secret, code: code, expires_in: div(@first_code_ms, 1000)}
  end

  @doc "A new code for a waiting website. Returns `{:ok, %{code, expires_in}}` or an error."
  def new_code(id, secret) do
    with {:ok, request} <- check(id, secret),
         nil <- request.result,
         true <- request.codes < @max_codes do
      code = random(16)
      :ets.delete(@table, {:code, request.code})

      :ets.insert(@table, [
        {{:id, id},
         %{request | code: code, codes: request.codes + 1, code_expires: now() + @next_code_ms}},
        {{:code, code}, id}
      ])

      {:ok, %{code: code, expires_in: div(@next_code_ms, 1000)}}
    else
      {:error, _} = error -> error
      _ -> {:error, :expired}
    end
  end

  @doc "Checks a website's id and secret. Returns `{:ok, request}` or `{:error, :not_found}`."
  def check(id, secret) when is_binary(id) and is_binary(secret) do
    case :ets.lookup(@table, {:id, id}) do
      [{_, request}] ->
        if Plug.Crypto.secure_compare(hash(secret), request.secret_hash),
          do: {:ok, request},
          else: {:error, :not_found}

      [] ->
        {:error, :not_found}
    end
  end

  def check(_, _), do: {:error, :not_found}

  @doc "The waiting website a code from a QR belongs to: `{:ok, id, request}` or `{:error, :not_found}`."
  def find(code) when is_binary(code) do
    now = now()

    with [{_, id}] <- :ets.lookup(@table, {:code, code}),
         [{_, %{code: ^code, result: nil} = request}] <- :ets.lookup(@table, {:id, id}),
         true <- request.code_expires > now do
      {:ok, id, request}
    else
      _ -> {:error, :not_found}
    end
  end

  def find(_), do: {:error, :not_found}

  @doc """
  Takes a code from a QR for the phone that is approving it, so no other
  phone can use it at the same time. Returns `{:ok, id, request}` or
  `{:error, :not_found}`. Follow with `finish/2`, or `release/2` if linking failed.
  """
  def claim(code) when is_binary(code) do
    now = now()

    with [{_, id}] <- :ets.take(@table, {:code, code}),
         [{_, %{code: ^code, result: nil} = request}] <- :ets.lookup(@table, {:id, id}),
         true <- request.code_expires > now do
      {:ok, id, request}
    else
      _ -> {:error, :not_found}
    end
  end

  def claim(_), do: {:error, :not_found}

  @doc "Puts a claimed code back, after linking failed (say, too many devices)."
  def release(id, code), do: :ets.insert_new(@table, {{:code, code}, id})

  @doc """
  Marks a claimed request as linked, so a website that reconnects in the
  next minute still gets `result`.
  """
  def finish(id, result) do
    case :ets.lookup(@table, {:id, id}) do
      [{key, request}] ->
        :ets.insert(
          @table,
          {key, %{request | result: result, code_expires: now() + @keep_result_ms}}
        )

      [] ->
        :ok
    end

    :ok
  end

  @doc "Forgets a request (the website got its result, or gave up)."
  def drop(id) do
    case :ets.lookup(@table, {:id, id}) do
      [{_, request}] -> :ets.delete(@table, {:code, request.code})
      [] -> :ok
    end

    :ets.delete(@table, {:id, id})
    :ok
  end

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl GenServer
  def init(nil) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    schedule()
    {:ok, nil}
  end

  @impl GenServer
  def handle_info(:sweep, state) do
    sweep()
    schedule()
    {:noreply, state}
  end

  @doc false
  def sweep do
    now = now()

    # A request goes once its code has run out and no new one can (or will)
    # be made, or once a linked result has waited long enough.
    for {{:id, id}, request} <- :ets.match_object(@table, {{:id, :_}, :_}),
        request.code_expires <= now,
        request.result != nil or request.codes >= @max_codes or request.ends <= now,
        do: drop(id)

    # Old codes whose website asked for a newer one are already gone, but a
    # code can outlive its request if the website never asked again.
    for {{:code, code}, id} <- :ets.match_object(@table, {{:code, :_}, :_}),
        :ets.lookup(@table, {:id, id}) == [],
        do: :ets.delete(@table, {:code, code})

    :ok
  end

  defp schedule, do: Process.send_after(self(), :sweep, 10_000)
  defp now, do: System.monotonic_time(:millisecond)
  defp random(n), do: Base.url_encode64(:crypto.strong_rand_bytes(n), padding: false)
  defp hash(secret), do: :crypto.hash(:sha256, secret)
end
