defmodule Pakchat.Accounts.GoogleKeys do
  @moduledoc """
  Google's public keys, which prove a sign-in token really came from Google.

  Google changes them every few days, so we fetch them from Google and keep
  them for as long as Google says they are good (usually a few hours).
  Tests swap this module for a fake one (see `config/test.exs`).
  """
  require Logger

  @callback key(kid :: String.t()) :: {:ok, JOSE.JWK.t()} | {:error, atom()}

  @url "https://www.googleapis.com/oauth2/v3/certs"
  @cache :pakchat_google_keys

  @doc "Finds the key with this id (`kid` in the token's header)."
  def key(kid) do
    with {:ok, keys} <- keys(), {:ok, jwk} <- Map.fetch(keys, kid) do
      {:ok, jwk}
    else
      :error -> {:error, :unknown_key}
      error -> error
    end
  end

  defp keys do
    case :persistent_term.get(@cache, nil) do
      {keys, expires} when is_integer(expires) ->
        if System.system_time(:second) < expires, do: {:ok, keys}, else: fetch()

      nil ->
        fetch()
    end
  end

  defp fetch do
    case Req.get(@url, retry: false, receive_timeout: 5_000) do
      {:ok, %{status: 200, body: %{"keys" => list}} = response} ->
        keys = Map.new(list, fn jwk -> {jwk["kid"], JOSE.JWK.from_map(jwk)} end)
        expires = System.system_time(:second) + max_age(response)
        :persistent_term.put(@cache, {keys, expires})
        {:ok, keys}

      other ->
        Logger.warning("Could not fetch Google's keys: #{inspect(other)}")
        {:error, :google_unreachable}
    end
  end

  # "Cache-Control: public, max-age=19800" means: good for 19800 seconds.
  defp max_age(response) do
    with [value | _] <- Req.Response.get_header(response, "cache-control"),
         [_, seconds] <- Regex.run(~r/max-age=(\d+)/, value) do
      String.to_integer(seconds)
    else
      _ -> 3600
    end
  end
end
