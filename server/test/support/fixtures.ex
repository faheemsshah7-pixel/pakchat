defmodule Pakchat.Fixtures do
  @moduledoc "Pretend people and devices for tests. The keys are random bytes of the right size."
  alias Pakchat.{Accounts, GoogleFake}
  alias PakchatWeb.Params

  def b64(size), do: Base.encode64(:crypto.strong_rand_bytes(size))

  @doc "A device's public keys, as the app would send them."
  def device_params(name \\ "Phone") do
    %{
      "name" => name,
      "registration_id" => Enum.random(1..16_000),
      "identity_key" => b64(33),
      "signed_pre_key" => %{"key_id" => 1, "public_key" => b64(33), "signature" => b64(64)},
      "kyber_last_resort" => %{
        "key_id" => 9999,
        "public_key" => b64(1569),
        "signature" => b64(64)
      }
    }
  end

  def pre_keys(from, count) do
    for id <- from..(from + count - 1), do: %{"key_id" => id, "public_key" => b64(33)}
  end

  def kyber_pre_keys(from, count) do
    for id <- from..(from + count - 1),
        do: %{"key_id" => id, "public_key" => b64(1569), "signature" => b64(64)}
  end

  @doc "A Google token for a new pretend person called `name`."
  def google_token(name, extra \\ %{}) do
    n = System.unique_integer([:positive])

    GoogleFake.token(
      Map.merge(
        %{
          "sub" => "google-#{n}",
          "email" => "#{String.downcase(name)}#{n}@gmail.com",
          "name" => name
        },
        extra
      )
    )
  end

  @doc "Signs a new person up on their phone. Returns `%{user, device, token}`."
  def person(name, extra \\ %{}) do
    {:ok, attrs} = Params.device(device_params())
    {:ok, result} = Accounts.sign_in_with_google(google_token(name, extra), attrs)
    result
  end

  @doc "Gives someone a linked device. Returns `%{device, token}`."
  def linked(user) do
    {:ok, attrs} = Params.device(device_params("Website"))
    {:ok, result} = Accounts.add_linked_device(user, attrs)
    result
  end
end
