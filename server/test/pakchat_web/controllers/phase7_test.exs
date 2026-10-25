defmodule PakchatWeb.Phase7Test do
  @moduledoc "Communities, invite links that run out, call links and reports."
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
    %{ali: person("Ali"), sara: person("Sara"), bilal: person("Bilal"), zara: person("Zara")}
  end

  describe "invite links that run out" do
    test "after so many people join", %{ali: ali, sara: sara, bilal: bilal, zara: zara} do
      g = group(ali, "Cricket", [])

      %{"code" => code, "max_uses" => 1} =
        as(ali)
        |> post(~p"/api/groups/#{g["id"]}/invite", %{"max_uses" => 1})
        |> json_response(200)

      assert as(sara) |> post(~p"/api/invites/#{code}/join") |> json_response(200)
      # Joining again doesn't use a place up, and the link is full for anyone new.
      assert as(sara) |> post(~p"/api/invites/#{code}/join") |> json_response(200)
      assert as(bilal) |> get(~p"/api/invites/#{code}") |> json_response(404)
      assert as(zara) |> post(~p"/api/invites/#{code}/join") |> json_response(404)

      chat = as(ali) |> get(~p"/api/chats/#{g["id"]}") |> json_response(200)
      assert chat["invite_uses"] == 1 and chat["invite_max_uses"] == 1
    end

    test "after a time", %{ali: ali, sara: sara} do
      g = group(ali, "Cricket", [])

      %{"code" => code, "expires_at" => at} =
        as(ali)
        |> post(~p"/api/groups/#{g["id"]}/invite", %{"expires_in" => 3600})
        |> json_response(200)

      assert at
      assert as(sara) |> get(~p"/api/invites/#{code}") |> json_response(200)

      Pakchat.Repo.update_all(Pakchat.Chats.Chat,
        set: [invite_expires_at: DateTime.add(DateTime.utc_now(), -1)]
      )

      assert as(sara) |> post(~p"/api/invites/#{code}/join") |> json_response(404)
    end

    test "odd limits are refused", %{ali: ali} do
      g = group(ali, "Cricket", [])

      assert as(ali)
             |> post(~p"/api/groups/#{g["id"]}/invite", %{"expires_in" => 5})
             |> json_response(400)

      assert as(ali)
             |> post(~p"/api/groups/#{g["id"]}/invite", %{"max_uses" => 0})
             |> json_response(400)
    end
  end

  describe "communities" do
    test "making one brings in my groups' people, with announcements only admins post in", %{
      ali: ali,
      sara: sara,
      bilal: bilal,
      zara: zara
    } do
      g1 = group(ali, "Class A", [sara])
      g2 = group(bilal, "Not mine", [zara])

      # Only my own groups can go in.
      assert as(ali)
             |> post(~p"/api/communities", %{"title" => "School", "group_ids" => [g2["id"]]})
             |> json_response(404)

      c =
        as(ali)
        |> post(~p"/api/communities", %{"title" => "School", "group_ids" => [g1["id"]]})
        |> json_response(201)

      assert c["kind"] == "community"
      assert ids(c) == Enum.sort([ali.user.id, sara.user.id])

      %{"groups" => groups} =
        as(sara) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(200)

      [ann, linked] = groups
      assert ann["announcements"] and ann["joined"] and ann["members"] == 2
      assert linked["id"] == g1["id"]

      ann_chat = as(sara) |> get(~p"/api/chats/#{ann["id"]}") |> json_response(200)
      assert ann_chat["only_admins_send"] and ann_chat["community_id"] == c["id"]

      # Someone outside can't see it.
      assert as(zara) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(404)

      # Adding someone to the community puts them in announcements too.
      assert as(ali)
             |> post(~p"/api/groups/#{c["id"]}/members", %{"user_ids" => [bilal.user.id]})
             |> json_response(200)

      assert length(
               (as(bilal)
                |> get(~p"/api/chats/#{ann["id"]}")
                |> json_response(200))["members"]
             ) == 3

      # Community members join its groups straight away.
      joined =
        as(bilal)
        |> post(~p"/api/communities/#{c["id"]}/groups/#{g1["id"]}/join")
        |> json_response(200)

      assert bilal.user.id in ids(joined)

      # Nobody leaves announcements alone, but leaving the community leaves it.
      assert as(bilal)
             |> delete(~p"/api/groups/#{ann["id"]}/members/#{bilal.user.id}")
             |> json_response(403)

      assert as(bilal)
             |> delete(~p"/api/groups/#{c["id"]}/members/#{bilal.user.id}")
             |> response(204)

      assert as(bilal) |> get(~p"/api/chats/#{ann["id"]}") |> json_response(404)
      # ...and every group in it, as on WhatsApp.
      assert as(bilal) |> get(~p"/api/chats/#{g1["id"]}") |> json_response(404)
    end

    test "new groups, unlinking, and admins", %{ali: ali, sara: sara} do
      c = as(ali) |> post(~p"/api/communities", %{"title" => "Mohalla"}) |> json_response(201)

      assert as(ali)
             |> post(~p"/api/groups/#{c["id"]}/members", %{"user_ids" => [sara.user.id]})
             |> json_response(200)

      %{"group_id" => gid} =
        as(ali)
        |> post(~p"/api/communities/#{c["id"]}/groups", %{"title" => "Events"})
        |> json_response(200)

      assert as(sara)
             |> post(~p"/api/communities/#{c["id"]}/groups", %{"title" => "Mine"})
             |> json_response(403)

      # Someone added to a community's group joins the community (already in here).
      assert as(sara)
             |> post(~p"/api/communities/#{c["id"]}/groups/#{gid}/join")
             |> json_response(200)

      # Community admins post announcements.
      %{"groups" => [ann | _]} =
        as(ali) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(200)

      assert as(ali)
             |> put(~p"/api/groups/#{c["id"]}/admins/#{sara.user.id}")
             |> json_response(200)

      roles = (as(sara) |> get(~p"/api/chats/#{ann["id"]}") |> json_response(200))["members"]
      assert Enum.find(roles, &(&1["user_id"] == sara.user.id))["role"] == "admin"

      # The name follows into announcements.
      assert as(ali)
             |> patch(~p"/api/groups/#{c["id"]}", %{"title" => "Mohalla 2"})
             |> json_response(200)

      assert (as(sara) |> get(~p"/api/chats/#{ann["id"]}") |> json_response(200))["title"] ==
               "Mohalla 2"

      # Announcements can't be taken out; other groups can.
      assert as(ali)
             |> delete(~p"/api/communities/#{c["id"]}/groups/#{ann["id"]}")
             |> json_response(403)

      assert as(ali) |> delete(~p"/api/communities/#{c["id"]}/groups/#{gid}") |> response(204)

      %{"groups" => left} =
        as(ali) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(200)

      assert length(left) == 1
    end

    test "invite links work for communities", %{ali: ali, sara: sara} do
      c = as(ali) |> post(~p"/api/communities", %{"title" => "Mohalla"}) |> json_response(201)
      %{"code" => code} = as(ali) |> post(~p"/api/groups/#{c["id"]}/invite") |> json_response(200)
      joined = as(sara) |> post(~p"/api/invites/#{code}/join") |> json_response(200)
      assert joined["kind"] == "community"

      %{"groups" => [ann]} =
        as(sara) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(200)

      assert ann["joined"]
    end

    test "members suggest groups when allowed, and admins approve them", %{ali: ali, sara: sara} do
      c = as(ali) |> post(~p"/api/communities", %{"title" => "Mohalla"}) |> json_response(201)
      as(ali) |> post(~p"/api/groups/#{c["id"]}/members", %{"user_ids" => [sara.user.id]})
      mine = group(sara, "Sara's", [])
      path = ~p"/api/communities/#{c["id"]}/suggestions"

      # Only admins add groups, until they let everyone suggest.
      assert as(sara) |> post(path, %{"title" => "Cooking"}) |> json_response(403)

      assert as(ali)
             |> patch(~p"/api/groups/#{c["id"]}", %{"groups_by_members" => true})
             |> json_response(200)
             |> Map.get("groups_by_members")

      assert as(sara)
             |> post(path, %{"title" => "Cooking", "group_ids" => [mine["id"]]})
             |> response(204)

      %{"suggestions" => list} = as(ali) |> get(path) |> json_response(200)
      {[cooking], [linked]} = Enum.split_with(list, & &1["new"])
      assert cooking["new"] and cooking["title"] == "Cooking"
      assert linked["title"] == "Sara's" and linked["suggested_by"] == sara.user.id

      # Sara sees her own; she can't approve them.
      assert length((as(sara) |> get(path) |> json_response(200))["suggestions"]) == 2
      assert as(sara) |> post("#{path}/#{cooking["id"]}") |> json_response(403)

      assert as(ali) |> post("#{path}/#{cooking["id"]}") |> response(204)
      assert as(ali) |> delete("#{path}/#{linked["id"]}") |> response(204)
      assert (as(ali) |> get(path) |> json_response(200))["suggestions"] == []

      %{"groups" => groups} =
        as(sara) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(200)

      made = Enum.find(groups, &(&1["title"] == "Cooking"))
      assert made["joined"]
      refute Enum.find(groups, &(&1["title"] == "Sara's"))
    end

    test "groups whose admins approve who joins", %{ali: ali, sara: sara, bilal: bilal} do
      c = as(ali) |> post(~p"/api/communities", %{"title" => "Mohalla"}) |> json_response(201)

      as(ali)
      |> post(~p"/api/groups/#{c["id"]}/members", %{"user_ids" => [sara.user.id, bilal.user.id]})

      %{"group_id" => gid} =
        as(ali)
        |> post(~p"/api/communities/#{c["id"]}/groups", %{"title" => "Quiet"})
        |> json_response(200)

      as(ali) |> patch(~p"/api/groups/#{gid}", %{"join_approval" => true}) |> json_response(200)
      join = ~p"/api/communities/#{c["id"]}/groups/#{gid}/join"

      assert as(sara) |> post(join) |> json_response(202) == %{"requested" => true}
      assert as(bilal) |> post(join) |> json_response(202)
      assert as(sara) |> get(~p"/api/chats/#{gid}") |> json_response(404)

      %{"groups" => groups} =
        as(sara) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(200)

      assert Enum.find(groups, &(&1["id"] == gid))["requested"]

      %{"requests" => requests} =
        as(ali) |> get(~p"/api/groups/#{gid}/requests") |> json_response(200)

      assert Enum.map(requests, & &1["user_id"]) == [sara.user.id, bilal.user.id]
      assert as(sara) |> get(~p"/api/groups/#{gid}/requests") |> json_response(404)

      assert as(ali) |> post(~p"/api/groups/#{gid}/requests/#{sara.user.id}") |> response(204)
      assert as(sara) |> get(~p"/api/chats/#{gid}") |> json_response(200)
      # Bilal takes his back.
      assert as(bilal)
             |> delete(~p"/api/groups/#{gid}/requests/#{bilal.user.id}")
             |> response(204)

      assert (as(ali) |> get(~p"/api/groups/#{gid}/requests") |> json_response(200))["requests"] ==
               []

      # By its invite link, too.
      %{"code" => code} = as(ali) |> post(~p"/api/groups/#{gid}/invite") |> json_response(200)
      assert as(bilal) |> post(~p"/api/invites/#{code}/join") |> json_response(202)
    end

    test "its owner deactivates it; its groups go on", %{ali: ali, sara: sara} do
      g = group(ali, "Class A", [sara])

      c =
        as(ali)
        |> post(~p"/api/communities", %{"title" => "School", "group_ids" => [g["id"]]})
        |> json_response(201)

      %{"groups" => [ann, _]} =
        as(ali) |> get(~p"/api/communities/#{c["id"]}/groups") |> json_response(200)

      as(ali) |> put(~p"/api/groups/#{c["id"]}/admins/#{sara.user.id}") |> json_response(200)
      assert c["created_by"] == ali.user.id
      # An admin isn't the owner.
      assert as(sara) |> delete(~p"/api/communities/#{c["id"]}") |> json_response(403)
      assert as(ali) |> delete(~p"/api/communities/#{c["id"]}") |> response(204)

      assert as(sara) |> get(~p"/api/chats/#{c["id"]}") |> json_response(404)
      assert as(sara) |> get(~p"/api/chats/#{ann["id"]}") |> json_response(404)
      still = as(sara) |> get(~p"/api/chats/#{g["id"]}") |> json_response(200)
      assert still["community_id"] == nil
    end
  end

  test "call links: anyone in it sees the link, and opening it joins", %{ali: ali, sara: sara} do
    link = as(ali) |> post(~p"/api/calls/links", %{"title" => "Study call"}) |> json_response(201)
    assert link["call_link"] and is_binary(link["invite_code"])
    joined = as(sara) |> post(~p"/api/invites/#{link["invite_code"]}/join") |> json_response(200)
    assert joined["invite_code"] == link["invite_code"]
  end

  test "reports carry the messages the phone sent along", %{ali: ali, sara: sara, bilal: bilal} do
    chat =
      as(ali) |> post(~p"/api/chats/direct", %{"user_id" => sara.user.id}) |> json_response(200)

    msgs = [%{"author" => sara.user.id, "text" => "buy now", "at" => 1}]

    assert %{"id" => _} =
             as(ali)
             |> post(~p"/api/reports", %{
               "chat_id" => chat["id"],
               "user_id" => sara.user.id,
               "reason" => "spam",
               "messages" => msgs
             })
             |> json_response(201)

    # Not someone else's chat, and not too many messages.
    assert as(bilal) |> post(~p"/api/reports", %{"chat_id" => chat["id"]}) |> json_response(404)
    too_many = List.duplicate(hd(msgs), 6)

    assert as(ali)
           |> post(~p"/api/reports", %{"chat_id" => chat["id"], "messages" => too_many})
           |> json_response(400)
  end

  test "an invite link opened in a browser offers to open PakChat", %{conn: conn} do
    body = conn |> get(~p"/join/abc_123") |> html_response(200)
    assert body =~ "pakchat://join/abc_123"
  end

  describe "photos" do
    defp upload(url, bytes) do
      build_conn()
      |> put_req_header("content-type", "application/octet-stream")
      |> put(url, bytes)
    end

    defp photo(owner, params) do
      %{"id" => id, "upload_url" => url} =
        as(owner) |> post(~p"/api/photos", Map.put(params, "size", 2000)) |> json_response(200)

      assert upload(url, :crypto.strong_rand_bytes(2000)).status == 204
      id
    end

    test "a profile photo, and who may see it", %{ali: ali, sara: sara, bilal: bilal} do
      id = photo(ali, %{})
      value = "pk1:#{id}:a2V5:ZGlnZXN0"
      assert as(ali) |> patch(~p"/api/me", %{"photo" => value}) |> json_response(200)
      # Anyone may fetch it, once they're shown its value.
      assert as(bilal) |> get(~p"/api/files/#{id}/link") |> json_response(200)

      assert (as(bilal) |> get(~p"/api/users/#{ali.user.id}") |> json_response(200))["photo"] ==
               value

      # My contacts only: Sara has a chat with me, Bilal doesn't.
      {:ok, _} = Pakchat.Chats.get_or_create_direct(ali.user, sara.user.id)

      assert as(ali)
             |> patch(~p"/api/me", %{"privacy" => %{"photo" => "contacts"}})
             |> json_response(200)
             |> get_in(["privacy", "photo"]) == "contacts"

      assert (as(sara) |> get(~p"/api/users/#{ali.user.id}") |> json_response(200))["photo"] ==
               value

      assert (as(bilal) |> get(~p"/api/users/#{ali.user.id}") |> json_response(200))["photo"] ==
               nil

      # A new photo deletes the old one.
      new = photo(ali, %{})

      as(ali)
      |> patch(~p"/api/me", %{"photo" => "pk1:#{new}:a2V5:ZGlnZXN0"})
      |> json_response(200)

      assert as(sara) |> get(~p"/api/files/#{id}/link") |> json_response(404)
    end

    test "a group's photo is its admins' to set", %{ali: ali, sara: sara} do
      g = group(ali, "Cricket", [sara])

      assert as(sara)
             |> post(~p"/api/photos", %{"size" => 2000, "chat_id" => g["id"]})
             |> json_response(404)

      id = photo(ali, %{"chat_id" => g["id"]})
      value = "pk1:#{id}:a2V5:ZGlnZXN0"

      assert as(ali)
             |> patch(~p"/api/groups/#{g["id"]}", %{"photo" => value})
             |> json_response(200)

      assert (as(sara) |> get(~p"/api/chats/#{g["id"]}") |> json_response(200))["photo"] == value
      assert as(ali) |> post(~p"/api/photos", %{"size" => 6 * 1024 * 1024}) |> json_response(422)
    end
  end
end
