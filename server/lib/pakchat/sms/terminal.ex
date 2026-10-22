defmodule Pakchat.Sms.Terminal do
  @moduledoc """
  The free way, for testing: the code is printed in the server's Terminal
  window instead of being sent. Type it into the app to sign in.
  """
  @behaviour Pakchat.Sms
  require Logger

  @impl Pakchat.Sms
  def deliver(phone, code) do
    Logger.info("""

    ┌──────────────────────────────────────────────┐
      PakChat sign-in code for #{phone}: #{code}
      (SMS=terminal: shown here instead of sent)
    └──────────────────────────────────────────────┘
    """)

    # The emulator tests can't read this window, so with test sign-in on they
    # can ask for the last code (GET /api/auth/test/code). Never on the live server.
    if Application.get_env(:pakchat, :test_sign_in, false) do
      :persistent_term.put({__MODULE__, phone}, code)
    end

    {:ok, :sent}
  end

  # We keep the code's hash ourselves (Pakchat.PhoneCodes), so this is never asked.
  @impl Pakchat.Sms
  def check(_phone, _code), do: {:error, :wrong_code}

  @doc "The last code printed for this number, only while test sign-in is on."
  def last_code(phone) do
    if Application.get_env(:pakchat, :test_sign_in, false),
      do: :persistent_term.get({__MODULE__, phone}, nil)
  end
end
