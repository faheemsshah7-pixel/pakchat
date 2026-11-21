defmodule PakchatWeb.Security.CodeRaceTest do
  @moduledoc "Many guesses at a sign-in code sent at once must not get past its 5 tries."
  use Pakchat.DataCase, async: false
  alias Pakchat.PhoneCodes

  test "30 wrong guesses at once: only 5 are checked, and the right code is then refused" do
    phone = "+923009998877"
    :ok = PhoneCodes.allow(phone, "sign_in", "424242")

    results =
      1..30
      |> Enum.map(fn n ->
        Task.async(fn ->
          PhoneCodes.check(phone, "sign_in", String.pad_leading("#{n}", 6, "0"))
        end)
      end)
      |> Enum.map(&Task.await/1)

    assert Enum.count(results, &(&1 == {:error, :wrong_code})) <= 5
    assert {:error, :too_many_tries} = PhoneCodes.check(phone, "sign_in", "424242")
  end
end
