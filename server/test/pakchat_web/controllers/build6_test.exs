defmodule PakchatWeb.Build6Test do
  @moduledoc "Privacy for About and for being added to groups, and what group members may do."
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures

  defp as(%{token: token}),
    do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  defp group(owner, title, members) do
    as(owner)
    |> post(~p"/api/groups", %{"title" => title, "member_ids" => Enum.map(members, & &1.user.id)})
    |> json_response(201)
  end

  defp ids(chat), do: chat["members"] |> Enum.map(& &1["user_id"]) |> Enum.sort()

  setup do
    %{ali: person("Ali"), sara: person("Sara"), bilal: person("Bilal")}
  end

  test "who sees my About", %{ali: ali, sara: sara, bilal: bilal} do
    about = fn viewer ->
      (as(viewer) |> get(~p"/api/users/#{ali.user.id}") |> json_response(200))["about"]
    end

    assert about.(bilal) == "Hey there! I am using PakChat."

    {:ok, _} = Pakchat.Chats.get_or_create_direct(ali.user, sara.user.id)

    assert as(ali)
           |> patch(~p"/api/me", %{"privacy" => %{"about" => "contacts"}})
           |> json_response(200)
           |> get_in(["privacy", "about"]) == "contacts"

    assert about.(sara) == "Hey there! I am using PakChat."
    assert about.(bilal) == nil

    as(ali) |> patch(~p"/api/me", %{"privacy" => %{"about" => "nobody"}}) |> json_response(200)
    assert about.(sara) == nil

    assert as(ali)
           |> patch(~p"/api/me", %{"privacy" => %{"about" => "aliens"}})
           |> json_response(422)
  end

  test "who can add me to groups", %{ali: ali, sara: sara, bilal: bilal} do
    # Sara lets only her contacts add her: Bilal has no chat with her, Ali does.
    as(sara)
    |> patch(~p"/api/me", %{"privacy" => %{"groups" => "contacts"}})
    |> json_response(200)

    {:ok, _} = Pakchat.Chats.get_or_create_direct(ali.user, sara.user.id)

    by_bilal = group(bilal, "Hockey", [sara, ali])
    assert ids(by_bilal) == Enum.sort([bilal.user.id, ali.user.id])

    g = group(ali, "Cricket", [])

    added =
      as(ali)
      |> post(~p"/api/groups/#{g["id"]}/members", %{"user_ids" => [sara.user.id]})
      |> json_response(200)

    assert sara.user.id in ids(added)

    g2 = group(bilal, "Squash", [])

    still =
      as(bilal)
      |> post(~p"/api/groups/#{g2["id"]}/members", %{"user_ids" => [sara.user.id]})
      |> json_response(200)

    refute sara.user.id in ids(still)
  end

  test "group permissions: everyone may edit its info, and add people", %{
    ali: ali,
    sara: sara,
    bilal: bilal
  } do
    g = group(ali, "Cricket", [sara])
    # Off at first: only admins.
    assert as(sara)
           |> patch(~p"/api/groups/#{g["id"]}", %{"title" => "Mine"})
           |> json_response(403)

    assert as(sara)
           |> post(~p"/api/groups/#{g["id"]}/members", %{"user_ids" => [bilal.user.id]})
           |> json_response(403)

    on =
      as(ali)
      |> patch(~p"/api/groups/#{g["id"]}", %{"members_edit" => true, "members_add" => true})
      |> json_response(200)

    assert on["members_edit"] and on["members_add"]

    assert (as(sara)
            |> patch(~p"/api/groups/#{g["id"]}", %{"title" => "Ours"})
            |> json_response(200))["title"] == "Ours"

    # Its settings stay the admins'.
    assert as(sara)
           |> patch(~p"/api/groups/#{g["id"]}", %{"only_admins_send" => true})
           |> json_response(403)

    added =
      as(sara)
      |> post(~p"/api/groups/#{g["id"]}/members", %{"user_ids" => [bilal.user.id]})
      |> json_response(200)

    assert bilal.user.id in ids(added)
  end
end
