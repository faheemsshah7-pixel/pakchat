defmodule PakchatWeb.Security.ScrapeTest do
  @moduledoc """
  Contact matching and lookups must not let a script list every PakChat user.
  Re-sending the same phone book is free; finding more and more different
  people each day stops at a daily cap, and so do lookups.
  """
  use PakchatWeb.ConnCase, async: false
  import Pakchat.Fixtures
  alias Pakchat.Repo

  defp as(token), do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  setup do
    limits = Application.fetch_env!(:pakchat, :rate_limits)
    on_exit(fn -> Application.put_env(:pakchat, :rate_limits, limits) end)

    Application.put_env(
      :pakchat,
      :rate_limits,
      Keyword.merge(limits, found_day: {3, 86_400_000}, lookup_day: {2, 86_400_000})
    )

    :ok
  end

  defp with_phone(name) do
    p = person(name)
    phone = "+92300" <> String.pad_leading("#{System.unique_integer([:positive])}", 7, "0")

    {:ok, user} =
      p.user |> Pakchat.Accounts.User.link_phone_changeset(%{phone: phone}) |> Repo.update()

    %{p | user: user}
  end

  defp hash(phone), do: Base.encode64(:crypto.hash(:sha256, phone))

  test "finding many different people a day stops; the same phone book again is fine" do
    me = person("Scraper")
    people = for n <- 1..5, do: with_phone("P#{n}")
    [a, b, c, d, e] = Enum.map(people, &hash(&1.user.phone))

    match = fn hashes ->
      me.token |> as() |> post(~p"/api/contacts/match", %{"phones" => hashes})
    end

    assert length(json_response(match.([a, b, c]), 200)) == 3
    # The same three again: nothing new found, fine.
    assert length(json_response(match.([a, b, c]), 200)) == 3
    # Two more different people: over the cap.
    assert match.([d, e]) |> json_response(429)
  end

  test "lookups have a daily cap" do
    me = person("Scraper")

    statuses =
      for n <- 1..3 do
        p = with_phone("L#{n}")
        me.token |> as() |> get(~p"/api/users/lookup?phone=#{p.user.phone}") |> Map.get(:status)
      end

    assert statuses == [200, 200, 429]
  end
end
