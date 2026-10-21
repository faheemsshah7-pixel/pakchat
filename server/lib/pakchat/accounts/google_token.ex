defmodule Pakchat.Accounts.GoogleToken do
  @moduledoc """
  Checks a Google sign-in token (an "ID token").

  The app signs in with Google and gets a token: a few facts about the person
  (their Gmail, name and Google id), signed by Google. We check:

  1. the signature, with Google's public key, so nobody can make one up;
  2. that Google made it for PakChat (`aud`), and not for some other app;
  3. that it was made by Google (`iss`) and hasn't run out (`exp`);
  4. that Google has checked the Gmail address belongs to them.
  """

  @issuers ["accounts.google.com", "https://accounts.google.com"]
  # Phone clocks can be a little off, so allow a minute either way.
  @leeway 60

  def verify(token) when is_binary(token) do
    with {:ok, kid} <- key_id(token),
         {:ok, jwk} <- key_source().key(kid),
         {true, %JOSE.JWT{fields: claims}, _} <- JOSE.JWT.verify_strict(jwk, ["RS256"], token),
         :ok <- check(claims) do
      {:ok, claims}
    else
      {false, _, _} -> {:error, :bad_signature}
      {:error, reason} -> {:error, reason}
    end
  end

  def verify(_), do: {:error, :malformed}

  # The token's header names which of Google's keys signed it.
  defp key_id(token) do
    case JOSE.JWS.to_map(JOSE.JWT.peek_protected(token)) do
      {_, %{"alg" => "RS256", "kid" => kid}} when is_binary(kid) -> {:ok, kid}
      _ -> {:error, :malformed}
    end
  rescue
    _ -> {:error, :malformed}
  end

  defp check(claims) do
    cond do
      claims["iss"] not in @issuers -> {:error, :wrong_issuer}
      claims["aud"] not in client_ids() -> {:error, :wrong_audience}
      not in_date?(claims) -> {:error, :expired}
      claims["email_verified"] not in [true, "true"] -> {:error, :email_not_verified}
      not is_binary(claims["sub"]) or not is_binary(claims["email"]) -> {:error, :malformed}
      true -> :ok
    end
  end

  # Not run out yet (`exp`), and not made in the future (`iat`).
  defp in_date?(%{"exp" => exp} = claims) when is_integer(exp) do
    now = System.system_time(:second)
    issued = claims["iat"]
    exp + @leeway >= now and (not is_integer(issued) or issued - @leeway <= now)
  end

  defp in_date?(_claims), do: false

  defp key_source, do: Application.get_env(:pakchat, :google_keys, Pakchat.Accounts.GoogleKeys)

  # PakChat's Google client ids (set in server/.env, see README.md).
  defp client_ids, do: Application.get_env(:pakchat, :google_client_ids, [])
end
