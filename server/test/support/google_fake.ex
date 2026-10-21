defmodule Pakchat.GoogleFake do
  @moduledoc """
  Pretend Google, for tests. It makes its own signing key, and signs
  sign-in tokens with it, just as Google does with its real one.
  """
  @behaviour Pakchat.Accounts.GoogleKeys

  @kid "pakchat-test-key"
  @client "pakchat-test.apps.googleusercontent.com"

  @impl true
  def key(@kid), do: {:ok, jwk()}
  def key(_), do: {:error, :unknown_key}

  @doc "Our pretend Google's key. Made once per test run (it takes a moment)."
  def jwk do
    case :persistent_term.get(__MODULE__, nil) do
      nil ->
        jwk = JOSE.JWK.generate_key({:rsa, 2048})
        :persistent_term.put(__MODULE__, jwk)
        jwk

      jwk ->
        jwk
    end
  end

  @doc "A signed token. `claims` change the defaults; `jwk:` signs with another key."
  def token(claims, opts \\ []) do
    now = System.system_time(:second)

    defaults = %{
      "iss" => "https://accounts.google.com",
      "aud" => @client,
      "iat" => now,
      "exp" => now + 3600,
      "email_verified" => true
    }

    header = %{"alg" => "RS256", "kid" => Keyword.get(opts, :kid, @kid)}

    {_, token} =
      Keyword.get(opts, :jwk, jwk())
      |> JOSE.JWT.sign(header, Map.merge(defaults, claims))
      |> JOSE.JWS.compact()

    token
  end
end
