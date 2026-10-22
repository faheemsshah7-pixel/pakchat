defmodule Pakchat.Sms do
  @moduledoc """
  Sends sign-in codes by SMS.

  Which service sends them is one setting, `SMS` in `server/.env`:

    * `SMS=terminal` (the default): nothing is sent. The code is printed in
      the Terminal window where the server runs. Free, for testing.
    * `SMS=twilio`: Twilio Verify sends real SMS to real SIMs. Also needs
      `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_VERIFY_SID`.

  The app is the same either way. To add another SMS company later, write one
  small module like `Pakchat.Sms.Twilio` and add its name below.
  """

  @doc """
  Sends `code` to `phone`. A service may make and check its own code (Twilio
  Verify does); then it answers `{:ok, :checks_itself}` and we ask it to check.
  """
  @callback deliver(phone :: String.t(), code :: String.t()) ::
              {:ok, :sent | :checks_itself} | {:error, term}

  @doc "Checks a code, for services that answered `:checks_itself`."
  @callback check(phone :: String.t(), code :: String.t()) :: :ok | {:error, :wrong_code}

  def service do
    case Application.get_env(:pakchat, :sms, "terminal") do
      "twilio" -> Pakchat.Sms.Twilio
      _ -> Pakchat.Sms.Terminal
    end
  end
end
