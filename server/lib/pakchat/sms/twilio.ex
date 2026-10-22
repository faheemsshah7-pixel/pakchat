defmodule Pakchat.Sms.Twilio do
  @moduledoc """
  Real SMS through Twilio Verify. Twilio makes the code, sends it and checks
  it, so it works in every country without a sender number of our own.

  Settings in `server/.env` (never in git): `SMS=twilio`, `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN` and `TWILIO_VERIFY_SID` (the Verify service, "VA...").
  """
  @behaviour Pakchat.Sms
  require Logger

  @base "https://verify.twilio.com/v2/Services"

  @impl Pakchat.Sms
  def deliver(phone, _our_code) do
    case post("Verifications", To: phone, Channel: "sms") do
      {:ok, %{status: status}} when status in 200..299 ->
        {:ok, :checks_itself}

      other ->
        Logger.error("Twilio didn't send the code: #{inspect(other)}")
        {:error, :sms_failed}
    end
  end

  @impl Pakchat.Sms
  def check(phone, code) do
    case post("VerificationCheck", To: phone, Code: code) do
      {:ok, %{status: 200, body: %{"status" => "approved"}}} -> :ok
      _ -> {:error, :wrong_code}
    end
  end

  defp post(path, form) do
    c = Application.get_env(:pakchat, :twilio, [])

    Req.post("#{@base}/#{c[:verify_sid]}/#{path}",
      form: form,
      auth: {:basic, "#{c[:account_sid]}:#{c[:auth_token]}"},
      retry: false
    )
  end
end
