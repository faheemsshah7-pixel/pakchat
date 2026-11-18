defmodule Pakchat.Pin do
  @moduledoc """
  Two-step verification, like WhatsApp: a 6-digit PIN the person makes, asked
  when their account signs in on a new phone (Pakchat.Accounts), so someone
  with their SIM or a copied code still can't take it over.

  Only a scrambled copy is kept: PBKDF2-SHA256 with a random salt, many rounds,
  so even someone with the database would need a long time per guess. Wrong
  tries are counted on the account: five are free, then each one waits twice as
  long as the last (1 minute, 2, 4, ... up to a day). A new install can't start
  the count again.

  Forgot the PIN: the Google account linked to PakChat proves it's them (when
  they signed in by number), or they wait 7 days, after which the account signs
  in without it (and the PIN is gone).
  """
  import Ecto.Changeset
  import Ecto.Query, only: [from: 2]
  alias Pakchat.Accounts.User
  alias Pakchat.Repo

  @free_tries 5
  @longest_wait 24 * 3600
  @reset_wait 7 * 24 * 3600
  @ticket_age 15 * 60

  defp rounds, do: Application.get_env(:pakchat, :pin_rounds, 600_000)

  @doc "A PIN is 6 digits."
  def valid?(pin), do: is_binary(pin) and String.match?(pin, ~r/\A\d{6}\z/)

  def on?(%User{pin_hash: hash}), do: is_binary(hash)

  @doc "Turns it on (or changes it). The count of wrong tries and any reset start over."
  def set(%User{} = user, pin) do
    if valid?(pin) do
      user
      |> change(
        pin_hash: scramble(pin),
        pin_failures: 0,
        pin_locked_until: nil,
        pin_reset_at: nil
      )
      |> Repo.update()
    else
      {:error, :bad_pin}
    end
  end

  def remove(%User{} = user) do
    user
    |> change(pin_hash: nil, pin_failures: 0, pin_locked_until: nil, pin_reset_at: nil)
    |> Repo.update()
  end

  @doc "Changing or turning it off needs the PIN it has now (`true` when it has none)."
  def mine?(%User{} = user, pin), do: not on?(user) or right?(user.pin_hash, pin)

  @doc """
  "Do you still know it?", from the person's own phone (the reminder). A right
  answer also stops a "wait 7 days" someone else may have asked for. It doesn't
  count towards the wait: the phone is already theirs.
  """
  def check_mine(%User{} = user, pin) do
    cond do
      not on?(user) -> {:error, :not_found}
      right?(user.pin_hash, pin) -> with({:ok, _} <- clear_reset(user), do: {:ok, true})
      true -> {:ok, false}
    end
  end

  defp clear_reset(%User{pin_reset_at: nil} = user), do: {:ok, user}
  defp clear_reset(user), do: user |> change(pin_reset_at: nil) |> Repo.update()

  @doc """
  A try while signing in. `:ok`, or `{:error, {:wrong_pin, tries_left}}`, or
  `{:error, {:pin_locked, seconds}}` while it has to wait.
  """
  def try_pin(%User{} = user, pin) do
    now = DateTime.utc_now()

    cond do
      not on?(user) ->
        :ok

      user.pin_locked_until && DateTime.compare(user.pin_locked_until, now) == :gt ->
        {:error, {:pin_locked, DateTime.diff(user.pin_locked_until, now)}}

      right?(user.pin_hash, pin) ->
        {:ok, _} =
          user
          |> change(pin_failures: 0, pin_locked_until: nil, pin_reset_at: nil)
          |> Repo.update()

        :ok

      true ->
        # Counted in the database itself, so two tries at once can't both slip through.
        {1, [failures]} =
          Repo.update_all(
            from(u in User, where: u.id == ^user.id, select: u.pin_failures),
            inc: [pin_failures: 1]
          )

        if failures >= @free_tries do
          wait = min(60 * Integer.pow(2, failures - @free_tries), @longest_wait)
          until = DateTime.add(now, wait, :second) |> DateTime.truncate(:second)

          Repo.update_all(from(u in User, where: u.id == ^user.id),
            set: [pin_locked_until: until]
          )

          {:error, {:pin_locked, wait}}
        else
          {:error, {:wrong_pin, @free_tries - failures}}
        end
    end
  end

  @doc "When a 7-day reset asked for now (or earlier) lets the account in without the PIN."
  def reset_ready_at(%User{pin_reset_at: nil}), do: nil
  def reset_ready_at(%User{pin_reset_at: at}), do: DateTime.add(at, @reset_wait, :second)

  def reset_ready?(%User{} = user) do
    case reset_ready_at(user) do
      nil -> false
      at -> DateTime.compare(at, DateTime.utc_now()) != :gt
    end
  end

  @doc "Starts the 7-day wait (once: asking again doesn't move it later)."
  def start_reset(%User{pin_reset_at: nil} = user) do
    user
    |> change(pin_reset_at: DateTime.utc_now() |> DateTime.truncate(:second))
    |> Repo.update()
  end

  def start_reset(%User{} = user), do: {:ok, user}

  ## The ticket: "this sign-in got past its code, and only needs the PIN"

  @doc "Signed by the server and good for 15 minutes; it says who, and how they signed in."
  def ticket(%User{id: id}, claims) do
    Phoenix.Token.sign(PakchatWeb.Endpoint, "pin", %{"u" => id, "c" => claims})
  end

  def read_ticket(ticket) when is_binary(ticket) do
    case Phoenix.Token.verify(PakchatWeb.Endpoint, "pin", ticket, max_age: @ticket_age) do
      {:ok, %{"u" => id, "c" => claims}} -> {:ok, id, claims}
      _ -> {:error, :bad_ticket}
    end
  end

  def read_ticket(_), do: {:error, :bad_ticket}

  ## Scrambling

  defp scramble(pin) do
    salt = :crypto.strong_rand_bytes(16)
    n = rounds()
    "pbkdf2-sha256$#{n}$#{Base.encode64(salt)}$#{Base.encode64(derive(pin, salt, n))}"
  end

  defp right?(hash, pin) when is_binary(hash) and is_binary(pin) do
    with true <- valid?(pin),
         ["pbkdf2-sha256", n, salt, want] <- String.split(hash, "$"),
         {n, ""} <- Integer.parse(n),
         {:ok, salt} <- Base.decode64(salt),
         {:ok, want} <- Base.decode64(want) do
      Plug.Crypto.secure_compare(derive(pin, salt, n), want)
    else
      _ -> false
    end
  end

  defp right?(_, _), do: false

  defp derive(pin, salt, n), do: :crypto.pbkdf2_hmac(:sha256, pin, salt, n, 32)
end
