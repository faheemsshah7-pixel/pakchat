defmodule Pakchat.Push.Fcm do
  @moduledoc """
  Sends alerts through Google's push service (Firebase Cloud Messaging), which
  is free.

  It needs the Firebase project's "service account" key file, kept only on
  the Mac (or the live server) and never in git. Put its path in
  `server/.env` as `FCM_SERVICE_ACCOUNT=/Users/you/pakchat-secrets/fcm.json`.
  Without it, alerts are only written in the log.

  The push carries no names and no words, because the server can't read
  messages anyway. It's "data only" and high priority: Android wakes the app,
  which collects and unlocks the message and shows "Sara: hi" itself.
  """
  require Logger

  @scope "https://www.googleapis.com/auth/firebase.messaging"

  def configured?, do: account() != nil

  @doc """
  Sends one alert. `:gone` means the phone's token is no longer valid.
  With `call: true` it says a call is ringing: it lives only a minute (a
  phone that was off shouldn't ring for a call that's over), and never
  replaces a waiting message alert.
  """
  def send(token, opts \\ []) do
    with %{} = acc <- account(),
         {:ok, access} <- access_token(acc) do
      body = %{message: Map.put(alert(opts[:call] == true), :token, token)}

      case Req.post("https://fcm.googleapis.com/v1/projects/#{acc["project_id"]}/messages:send",
             json: body,
             auth: {:bearer, access},
             retry: false
           ) do
        {:ok, %{status: 200}} ->
          :ok

        # UNREGISTERED: the app was removed, or Google gave it a new token.
        {:ok, %{status: 404}} ->
          :gone

        other ->
          Logger.warning("FCM refused an alert: #{inspect(other)}")
          {:error, other}
      end
    else
      nil -> {:error, :not_configured}
      error -> error
    end
  end

  @doc false
  def alert(true = _call) do
    %{
      android: %{priority: "high", ttl: "60s", collapse_key: "pakchat-call"},
      data: %{wake: "1", call: "1"}
    }
  end

  def alert(false) do
    %{
      android: %{priority: "high", ttl: "86400s", collapse_key: "pakchat-wake"},
      data: %{wake: "1"}
    }
  end

  # The key file, read once.
  defp account do
    case :persistent_term.get({__MODULE__, :account}, :unread) do
      :unread ->
        acc =
          with path when is_binary(path) <- Application.get_env(:pakchat, :fcm_service_account),
               {:ok, text} <- File.read(path),
               {:ok, %{"private_key" => _, "client_email" => _} = acc} <- Jason.decode(text) do
            acc
          else
            _ -> nil
          end

        :persistent_term.put({__MODULE__, :account}, acc)
        acc

      acc ->
        acc
    end
  end

  # Google wants a short-lived access token, made by signing a request with
  # the key file. Each one lasts an hour, so we keep it until just before then.
  defp access_token(acc) do
    now = System.system_time(:second)

    case :persistent_term.get({__MODULE__, :token}, nil) do
      {token, until} when until > now + 60 ->
        {:ok, token}

      _ ->
        claims = %{
          "iss" => acc["client_email"],
          "scope" => @scope,
          "aud" => acc["token_uri"] || "https://oauth2.googleapis.com/token",
          "iat" => now,
          "exp" => now + 3600
        }

        jwk = JOSE.JWK.from_pem(acc["private_key"])
        {_, assertion} = jwk |> JOSE.JWT.sign(%{"alg" => "RS256"}, claims) |> JOSE.JWS.compact()

        case Req.post(claims["aud"],
               form: [
                 grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                 assertion: assertion
               ],
               retry: false
             ) do
          {:ok, %{status: 200, body: %{"access_token" => token, "expires_in" => secs}}} ->
            :persistent_term.put({__MODULE__, :token}, {token, now + secs})
            {:ok, token}

          other ->
            Logger.error("FCM sign-in failed: #{inspect(other)}")
            {:error, :fcm_auth}
        end
    end
  end
end
