defmodule Pakchat.PhoneCodes do
  @moduledoc """
  Sign-in codes sent by SMS, with limits, because every SMS costs money:

    * a whole-server cap per day (`SMS_DAILY_CAP`, 100 unless set),
    * at most 5 codes a day to one number, and one every 30 seconds,
    * 5 tries per code, and each code lasts 10 minutes.

  Only a hash of each code is kept, and old rows are cleared every hour.
  """
  import Ecto.Query
  alias Pakchat.PhoneCodes.Code
  alias Pakchat.{Repo, Sms}

  @per_number_per_day 5
  @wait_seconds 30
  @tries 5
  @lasts_minutes 10

  @doc ~s(Makes a code and sends it. `purpose` is "sign_in" or "link".)
  def send_code(phone, purpose) do
    now = DateTime.utc_now()
    day_ago = DateTime.add(now, -1, :day)

    sent_today = Repo.aggregate(from(c in Code, where: c.inserted_at > ^day_ago), :count)

    to_number =
      Repo.all(
        from c in Code,
          where: c.phone == ^phone and c.inserted_at > ^day_ago,
          select: c.inserted_at
      )

    cond do
      sent_today >= daily_cap() ->
        {:error, :sms_cap}

      length(to_number) >= @per_number_per_day ->
        {:error, :too_many_codes}

      Enum.any?(to_number, &(DateTime.diff(now, &1) < @wait_seconds)) ->
        {:error, :wait}

      true ->
        code = new_code()

        with {:ok, how} <- Sms.service().deliver(phone, code) do
          Repo.insert!(%Code{
            phone: phone,
            purpose: purpose,
            code_hash: if(how == :sent, do: hash(phone, code)),
            expires_at: DateTime.add(now, @lasts_minutes, :minute)
          })

          {:ok, %{resend_after: @wait_seconds}}
        end
    end
  end

  @doc """
  Lets `code` sign in (or link) `phone` once, without sending anything: used
  when the number has already proved itself another way (Pakchat.WhatsApp).
  """
  def allow(phone, purpose, code) when is_binary(code) do
    Repo.insert!(%Code{
      phone: phone,
      purpose: purpose,
      code_hash: hash(phone, code),
      expires_at: DateTime.add(DateTime.utc_now(), @lasts_minutes, :minute)
    })

    :ok
  end

  @doc "Checks a code. A code works once."
  def check(phone, purpose, code) when is_binary(code) do
    now = DateTime.utc_now()

    latest =
      Repo.one(
        from c in Code,
          where: c.phone == ^phone and c.purpose == ^purpose and c.expires_at > ^now,
          order_by: [desc: c.inserted_at],
          limit: 1
      )

    cond do
      latest == nil ->
        {:error, :wrong_code}

      latest.tries >= @tries ->
        {:error, :too_many_tries}

      true ->
        Repo.update_all(from(c in Code, where: c.id == ^latest.id), inc: [tries: 1])

        ok? =
          if latest.code_hash,
            do: Plug.Crypto.secure_compare(latest.code_hash, hash(phone, String.trim(code))),
            else: Sms.service().check(phone, String.trim(code)) == :ok

        if ok? do
          Repo.delete_all(from c in Code, where: c.phone == ^phone and c.purpose == ^purpose)
          :ok
        else
          {:error, :wrong_code}
        end
    end
  end

  def check(_, _, _), do: {:error, :wrong_code}

  @doc "Deletes codes older than two days (they only count towards the daily caps)."
  def delete_old do
    two_days_ago = DateTime.add(DateTime.utc_now(), -2, :day)
    {count, _} = Repo.delete_all(from c in Code, where: c.inserted_at < ^two_days_ago)
    count
  end

  # Six digits, from a proper random source.
  defp new_code do
    <<n::unsigned-32>> = :crypto.strong_rand_bytes(4)
    n |> rem(1_000_000) |> Integer.to_string() |> String.pad_leading(6, "0")
  end

  defp hash(phone, code), do: :crypto.hash(:sha256, phone <> ":" <> code)

  defp daily_cap, do: Application.get_env(:pakchat, :sms_daily_cap, 100)
end
