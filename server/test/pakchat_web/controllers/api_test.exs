defmodule PakchatWeb.ApiTest do
  @moduledoc "Profiles, keys, chats, groups, invites and blocks over /api."
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures

  defp as(%{token: token}),
    do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  setup do
    %{ali: person("Ali"), sara: person("Sara"), bilal: person("Bilal")}
  end

  describe "profiles" do
    test "changing my name, about and privacy", %{ali: ali} do
      body =
        as(ali)
        |> patch(~p"/api/me", %{
          "name" => "Ali Khan",
          "about" => "Studying",
          "privacy" => %{"last_seen" => "contacts", "online" => "same", "read_receipts" => false}
        })
        |> json_response(200)

      assert body["name"] == "Ali Khan"

      assert body["privacy"] == %{
               "last_seen" => "contacts",
               "online" => "same",
               "read_receipts" => false
             }
    end

    test "made-up privacy choices are refused", %{ali: ali} do
      conn = as(ali) |> patch(~p"/api/me", %{"privacy" => %{"last_seen" => "my mum"}})
      assert %{"fields" => %{"last_seen_visibility" => _}} = json_response(conn, 422)
    end

    test "finding someone by Gmail, in any case", %{ali: ali, sara: sara} do
      email = String.upcase(sara.user.email)
      body = as(ali) |> get(~p"/api/users/lookup?email=#{email}") |> json_response(200)
      assert body["id"] == sara.user.id
      # Other people's Gmail and settings aren't shown.
      refute Map.has_key?(body, "email")
      refute Map.has_key?(body, "privacy")

      assert as(ali) |> get(~p"/api/users/lookup?email=nobody@gmail.com") |> json_response(404)
    end

    test "looking up too many people is stopped", %{ali: ali} do
      statuses =
        for _ <- 1..31, do: (as(ali) |> get(~p"/api/users/lookup?email=x@gmail.com")).status

      assert Enum.take(statuses, 30) |> Enum.all?(&(&1 == 404))
      assert List.last(statuses) == 429
    end
  end

  describe "keys" do
    test "each one-time key is handed out once, then the last-resort key", %{ali: ali, sara: sara} do
      %{"ec" => 3, "kyber" => 2} =
        as(sara)
        |> post(~p"/api/keys", %{
          "pre_keys" => pre_keys(1, 3),
          "kyber_pre_keys" => kyber_pre_keys(1, 2)
        })
        |> json_response(200)

      claim = fn ->
        [bundle] =
          as(ali)
          |> post(~p"/api/users/#{sara.user.id}/bundles")
          |> json_response(200)
          |> Map.fetch!("bundles")

        bundle
      end

      first = claim.()
      second = claim.()
      third = claim.()
      fourth = claim.()

      assert [first, second, third] |> Enum.map(& &1["pre_key_id"]) |> Enum.sort() == [1, 2, 3]
      assert fourth["pre_key_id"] == nil
      assert [first, second] |> Enum.map(& &1["kyber_pre_key_id"]) |> Enum.sort() == [1, 2]
      # Out of one-time Kyber keys: the last-resort one.
      assert third["kyber_pre_key_id"] == 9999
      assert first["identity_key"] == Base.encode64(sara.device.identity_key)

      assert %{"ec" => 0, "kyber" => 0} = as(sara) |> get(~p"/api/keys") |> json_response(200)
    end

    test "a bundle for each device", %{ali: ali, sara: sara} do
      linked(sara.user)

      assert %{"devices" => [1, 2]} =
               as(ali) |> get(~p"/api/users/#{sara.user.id}/devices") |> json_response(200)

      %{"bundles" => bundles} =
        as(ali) |> post(~p"/api/users/#{sara.user.id}/bundles") |> json_response(200)

      assert Enum.map(bundles, & &1["device_id"]) == [1, 2]
    end

    test "keys of the wrong size are refused", %{sara: sara} do
      conn =
        as(sara)
        |> post(~p"/api/keys", %{"pre_keys" => [%{"key_id" => 1, "public_key" => b64(5000)}]})

      assert json_response(conn, 422)
    end
  end

  describe "chats" do
    test "a one-to-one chat is the same chat both ways", %{ali: ali, sara: sara} do
      a =
        as(ali) |> post(~p"/api/chats/direct", %{"user_id" => sara.user.id}) |> json_response(200)

      b =
        as(sara) |> post(~p"/api/chats/direct", %{"user_id" => ali.user.id}) |> json_response(200)

      assert a["id"] == b["id"]
      assert a["kind"] == "direct"
    end

    test "messaging yourself works", %{ali: ali} do
      chat =
        as(ali) |> post(~p"/api/chats/direct", %{"user_id" => ali.user.id}) |> json_response(200)

      assert [%{"user_id" => id}] = chat["members"]
      assert id == ali.user.id
    end

    test "nobody can see a chat they're not in", %{ali: ali, sara: sara, bilal: bilal} do
      chat =
        as(ali) |> post(~p"/api/chats/direct", %{"user_id" => sara.user.id}) |> json_response(200)

      assert as(bilal) |> get(~p"/api/chats/#{chat["id"]}") |> json_response(404)
      assert as(bilal) |> get(~p"/api/chats") |> json_response(200) == %{"chats" => []}
      assert as(sara) |> get(~p"/api/chats/#{chat["id"]}") |> json_response(200)
      assert as(sara) |> get(~p"/api/chats/not-a-chat") |> json_response(404)
    end
  end

  describe "groups" do
    setup %{ali: ali, sara: sara} do
      group =
        as(ali)
        |> post(~p"/api/groups", %{"title" => "Study group", "member_ids" => [sara.user.id]})
        |> json_response(201)

      %{group: group}
    end

    test "whoever makes the group is its admin", %{group: group, ali: ali, sara: sara} do
      roles = Map.new(group["members"], &{&1["user_id"], &1["role"]})
      assert roles == %{ali.user.id => "admin", sara.user.id => "member"}
    end

    test "only admins can change the group", %{group: group, sara: sara, bilal: bilal, ali: ali} do
      id = group["id"]

      assert as(sara)
             |> patch(~p"/api/groups/#{id}", %{"title" => "Mine now"})
             |> json_response(403)

      assert as(sara)
             |> post(~p"/api/groups/#{id}/members", %{"user_ids" => [bilal.user.id]})
             |> json_response(403)

      assert as(sara)
             |> delete(~p"/api/groups/#{id}/members/#{ali.user.id}")
             |> json_response(403)

      assert as(sara) |> put(~p"/api/groups/#{id}/admins/#{sara.user.id}") |> json_response(403)
      assert as(sara) |> post(~p"/api/groups/#{id}/invite") |> json_response(403)

      # Someone outside the group can't even tell it exists.
      assert as(bilal) |> patch(~p"/api/groups/#{id}", %{"title" => "Hi"}) |> json_response(404)

      assert as(ali)
             |> patch(~p"/api/groups/#{id}", %{"title" => "Physics"})
             |> json_response(200)

      body =
        as(ali)
        |> post(~p"/api/groups/#{id}/members", %{"user_ids" => [bilal.user.id]})
        |> json_response(200)

      assert length(body["members"]) == 3
    end

    test "anyone can leave, and the group always keeps an admin", %{
      group: group,
      ali: ali,
      sara: sara
    } do
      id = group["id"]
      assert as(ali) |> delete(~p"/api/groups/#{id}/members/#{ali.user.id}") |> response(204)
      body = as(sara) |> get(~p"/api/chats/#{id}") |> json_response(200)
      assert body["members"] == [%{"user_id" => sara.user.id, "role" => "admin"}]
      assert as(ali) |> get(~p"/api/chats/#{id}") |> json_response(404)
    end

    test "invite links", %{group: group, ali: ali, sara: sara, bilal: bilal} do
      id = group["id"]
      %{"code" => code} = as(ali) |> post(~p"/api/groups/#{id}/invite") |> json_response(200)

      # Members don't see the code; admins do.
      assert as(sara) |> get(~p"/api/chats/#{id}") |> json_response(200) |> Map.get("invite_code") ==
               nil

      assert as(ali) |> get(~p"/api/chats/#{id}") |> json_response(200) |> Map.get("invite_code") ==
               code

      assert %{"title" => "Study group", "members" => 2} =
               as(bilal) |> get(~p"/api/invites/#{code}") |> json_response(200)

      joined = as(bilal) |> post(~p"/api/invites/#{code}/join") |> json_response(200)
      assert length(joined["members"]) == 3

      # A new link: the old one stops working.
      %{"code" => new_code} = as(ali) |> post(~p"/api/groups/#{id}/invite") |> json_response(200)
      assert new_code != code
      assert as(bilal) |> get(~p"/api/invites/#{code}") |> json_response(404)

      assert as(ali) |> delete(~p"/api/groups/#{id}/invite") |> response(204)
      assert as(bilal) |> get(~p"/api/invites/#{new_code}") |> json_response(404)
    end
  end

  test "blocking and unblocking", %{ali: ali, sara: sara} do
    assert as(ali) |> put(~p"/api/blocks/#{sara.user.id}") |> response(204)

    assert [%{"id" => id}] =
             as(ali) |> get(~p"/api/blocks") |> json_response(200) |> Map.fetch!("blocked")

    assert id == sara.user.id
    assert as(ali) |> delete(~p"/api/blocks/#{sara.user.id}") |> response(204)
    assert as(ali) |> get(~p"/api/blocks") |> json_response(200) == %{"blocked" => []}
  end
end
