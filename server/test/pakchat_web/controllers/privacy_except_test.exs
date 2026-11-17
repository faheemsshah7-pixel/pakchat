defmodule PakchatWeb.PrivacyExceptTest do
  @moduledoc "\"My contacts except…\": last seen, photo, About and groups, leaving some contacts out."
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures
  alias Pakchat.{Accounts, Chats, Privacy}

  defp as(%{token: token}),
    do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  setup do
    ali = person("Ali")
    sara = person("Sara")
    bilal = person("Bilal")
    zara = person("Zara")
    # Sara and Bilal are Ali's contacts (one-to-one chats); Zara isn't.
    {:ok, _} = Chats.get_or_create_direct(ali.user, sara.user.id)
    {:ok, _} = Chats.get_or_create_direct(ali.user, bilal.user.id)
    %{ali: ali, sara: sara, bilal: bilal, zara: zara}
  end

  test "photo and About: contacts except Sara", %{ali: ali, sara: sara, bilal: bilal, zara: zara} do
    {:ok, _} = Accounts.update_profile(ali.user, %{"about" => "Hi"})

    body =
      as(ali)
      |> patch(~p"/api/me", %{
        "privacy" => %{
          "photo" => "except",
          "about" => "except",
          "except" => %{"photo" => [sara.user.id], "about" => [sara.user.id]}
        }
      })
      |> json_response(200)

    assert body["privacy"]["photo"] == "except"
    assert body["privacy"]["except"]["photo"] == [sara.user.id]
    assert body["privacy"]["except"]["last_seen"] == []

    seen = fn who -> as(who) |> get(~p"/api/users/#{ali.user.id}") |> json_response(200) end
    assert %{"about" => nil} = seen.(sara)
    assert %{"about" => "Hi"} = seen.(bilal)
    # Not a contact: not shown, the same as "My contacts".
    assert %{"about" => nil} = seen.(zara)

    me = Accounts.get_user(ali.user.id)
    refute Privacy.can_see_photo?(Accounts.get_user(sara.user.id), me)
    assert Privacy.can_see_photo?(Accounts.get_user(bilal.user.id), me)
    refute Privacy.can_see_photo?(Accounts.get_user(zara.user.id), me)
  end

  test "last seen: contacts except Bilal", %{ali: ali, sara: sara, bilal: bilal} do
    {:ok, user} =
      Accounts.update_profile(ali.user, %{
        "last_seen_visibility" => "except",
        "privacy_except" => %{"last_seen" => [bilal.user.id]}
      })

    assert Privacy.can_see_last_seen?(Accounts.get_user(sara.user.id), user)
    refute Privacy.can_see_last_seen?(Accounts.get_user(bilal.user.id), user)
  end

  test "groups: contacts except Sara can't add me", %{
    ali: ali,
    sara: sara,
    bilal: bilal,
    zara: zara
  } do
    {:ok, user} =
      Accounts.update_profile(ali.user, %{
        "groups_visibility" => "except",
        "privacy_except" => %{"groups" => [sara.user.id]}
      })

    refute Privacy.can_add_to_group?(sara.user.id, user)
    assert Privacy.can_add_to_group?(bilal.user.id, user)
    refute Privacy.can_add_to_group?(zara.user.id, user)
  end

  test "giving one list keeps the others", %{ali: ali, sara: sara, bilal: bilal} do
    as(ali)
    |> patch(~p"/api/me", %{"privacy" => %{"except" => %{"photo" => [sara.user.id]}}})
    |> json_response(200)

    body =
      as(ali)
      |> patch(~p"/api/me", %{"privacy" => %{"except" => %{"about" => [bilal.user.id]}}})
      |> json_response(200)

    assert body["privacy"]["except"]["photo"] == [sara.user.id]
    assert body["privacy"]["except"]["about"] == [bilal.user.id]
  end

  test "ids are kept lower case and once", %{ali: ali, sara: sara} do
    loud = String.upcase(sara.user.id)

    body =
      as(ali)
      |> patch(~p"/api/me", %{
        "privacy" => %{"photo" => "except", "except" => %{"photo" => [loud, sara.user.id]}}
      })
      |> json_response(200)

    assert body["privacy"]["except"]["photo"] == [sara.user.id]
    refute Privacy.can_see_photo?(Accounts.get_user(sara.user.id), Accounts.get_user(ali.user.id))
  end

  test "bad lists are refused", %{ali: ali} do
    for bad <- [%{"photo" => ["not-an-id"]}, %{"nickname" => []}, %{"photo" => "x"}, "x"] do
      conn = as(ali) |> patch(~p"/api/me", %{"privacy" => %{"except" => bad}})
      assert json_response(conn, 422)
    end
  end

  test "online is not an \"except\" setting", %{ali: ali} do
    conn = as(ali) |> patch(~p"/api/me", %{"privacy" => %{"online" => "except"}})
    assert json_response(conn, 422)
  end
end
