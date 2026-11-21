defmodule PakchatWeb.Security.PinRaceTest do
  @moduledoc """
  Many PIN tries sent at the same moment must not all be checked (more than 5
  free guesses, and heavy CPU each): one check runs at a time per account.
  """
  use Pakchat.DataCase, async: false
  import Pakchat.Fixtures
  alias Pakchat.Accounts.User
  alias Pakchat.{Pin, Repo}

  test "20 wrong tries at once: at most 5 are checked" do
    ali = person("Ali")
    {:ok, user} = Pin.set(ali.user, "246810")

    results =
      1..20
      |> Enum.map(fn n ->
        Task.async(fn -> Pin.try_pin(user, String.pad_leading("#{n}", 6, "0")) end)
      end)
      |> Enum.map(&Task.await(&1, 30_000))

    assert Repo.get!(User, user.id).pin_failures <= 5
    assert Enum.count(results, &match?({:error, {:wrong_pin, _}}, &1)) <= 5
    refute :ok in results
  end

  test "the right PIN still works, one try after another" do
    ali = person("Ali")
    {:ok, user} = Pin.set(ali.user, "246810")
    assert {:error, {:wrong_pin, 4}} = Pin.try_pin(user, "000000")
    assert :ok = Pin.try_pin(Repo.get!(User, user.id), "246810")
  end
end
