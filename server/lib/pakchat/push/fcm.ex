defmodule Pakchat.Push.Fcm do
  @moduledoc """
  Sends alerts through Google's push service (Firebase Cloud Messaging), which
  is free.

  It needs the Firebase project's "service account" key file, kept only on
  the Mac (or the live server) and never in git. Put its path in
  `server/.env` as `FCM_SERVICE_ACCOUNT=/Users/you/pakchat-secrets/fcm.json`.
  Without it, alerts are only written in the log.

  The push carries no names and no readable words, because the server can't
  read messages anyway. Like WhatsApp's, it can carry the newest messages still
  LOCKED (Signal's end-to-end encryption, which only the phone can open; Google
  sees only scrambled bytes), so the phone shows "Sara: hi" at once instead of
  connecting to us first. It's "data only" and high priority: Android wakes the
  app, which unlocks the message and shows the alert itself.
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
      body = %{
        message: Map.put(alert(opts[:call] == true, opts[:envelopes] || []), :token, token)
      }

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
  def alert(call, envelopes \\ [])

  def alert(true = _call, envelopes) do
    %{
      android: %{priority: "high", ttl: "60s", collapse_key: "pakchat-call"},
      data: with_envelopes(%{wake: "1", call: "1"}, envelopes)
    }
  end

  def alert(false, envelopes) do
    %{
      android: %{priority: "high", ttl: "86400s", collapse_key: "pakchat-wake"},
      data: with_envelopes(%{wake: "1"}, envelopes)
    }
  end

  # Google takes at most 4 KB of data in a push: room for a few short messages.
  @room 3_200

  @doc """
  The locked envelopes (already in the app's wire shape) that fit, oldest
  first, as one JSON text under "env". Any that don't fit come the usual way,
  when the phone connects.
  """
  def with_envelopes(data, []), do: data

  def with_envelopes(data, envelopes) do
    {fit, _} =
      Enum.reduce(envelopes, {[], 2}, fn e, {list, used} ->
        size = byte_size(Jason.encode!(e)) + 1
        if used + size <= @room, do: {[e | list], used + size}, else: {list, @room + 1}
      end)

    case fit do
      [] -> data
      list -> Map.put(data, :env, Jason.encode!(Enum.reverse(list)))
    end
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
