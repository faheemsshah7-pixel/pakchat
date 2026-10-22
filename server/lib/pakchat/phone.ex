defmodule Pakchat.Phone do
  @moduledoc """
  Phone numbers, written one way everywhere: "+" and the country code, then
  the number, with no spaces (the "E.164" form), like `+923001234567`.

  People type numbers every way: `0300 1234567`, `0300-1234567`,
  `+92 300 1234567`, `0092300...`. A number that starts with a single 0 is
  taken to be in the default country (Pakistan, 92).
  """

  @doc "Tidies a typed number. Returns `{:ok, \"+92...\"}` or `{:error, :bad_phone}`."
  def normalize(text) when is_binary(text) do
    trimmed = String.trim(text)
    digits = String.replace(trimmed, ~r/[\s\-\(\)\.]/u, "")

    number =
      cond do
        String.starts_with?(digits, "+") -> String.slice(digits, 1..-1//1)
        String.starts_with?(digits, "00") -> String.slice(digits, 2..-1//1)
        String.starts_with?(digits, "0") -> default_country() <> String.slice(digits, 1..-1//1)
        true -> digits
      end

    # E.164: 8 to 15 digits, and a country code never starts with 0.
    if number =~ ~r/^[1-9][0-9]{7,14}$/, do: {:ok, "+" <> number}, else: {:error, :bad_phone}
  end

  def normalize(_), do: {:error, :bad_phone}

  @doc """
  The hash a phone sends to ask "is this number on PakChat?": SHA-256 of the
  tidied number. The app makes exactly the same one (shared/src/contacts.ts).
  """
  def hash(phone) when is_binary(phone), do: :crypto.hash(:sha256, phone)

  @doc "The same for a Gmail address, lowercased first."
  def email_hash(email) when is_binary(email),
    do: :crypto.hash(:sha256, email |> String.trim() |> String.downcase())

  defp default_country, do: Application.get_env(:pakchat, :phone_country, "92")
end
