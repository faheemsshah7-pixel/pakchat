defmodule PakchatWeb.Security.ContactsRuleTest do
  @moduledoc """
  "My contacts" in Privacy must mean people I chose to talk to: I started our
  one-to-one chat, or I wrote back in it. A stranger who just opens a chat with
  me is not my contact (they can't see a contacts-only photo, About or last
  seen, or add me to groups).
  """
  use Pakchat.DataCase, async: true
  import Pakchat.Fixtures
  alias Pakchat.{Accounts, Chats, Privacy, Relay}

  defp contacts_only(user) do
    {:ok, user} =
      Accounts.update_profile(user, %{
        "photo_visibility" => "contacts",
        "about_visibility" => "contacts",
        "last_seen_visibility" => "contacts",
        "groups_visibility" => "contacts"
      })

    user
  end

  defp sees_all?(viewer, owner) do
    Privacy.can_see_photo?(viewer, owner) and Privacy.can_see_about?(viewer, owner) and
      Privacy.can_see_last_seen?(viewer, owner) and Privacy.can_add_to_group?(viewer.id, owner)
  end

  defp sees_none?(viewer, owner) do
    not Privacy.can_see_photo?(viewer, owner) and not Privacy.can_see_about?(viewer, owner) and
      not Privacy.can_see_last_seen?(viewer, owner) and
      not Privacy.can_add_to_group?(viewer.id, owner)
  end

  defp reply(person, to, chat) do
    {:ok, _} =
      Relay.send_message(person.device, chat.id, %{
        kind: "message",
        envelopes: [
          %{user_id: to.user.id, device_id: to.device.device_id, type: 2, body: "locked"}
        ],
        group: nil
      })
  end

  test "a stranger who opens a chat with me is not my contact until I write back" do
    owner = person("Owner")
    stranger = person("Stranger")
    owner_user = contacts_only(owner.user)

    {:ok, chat} = Chats.get_or_create_direct(stranger.user, owner.user.id)
    assert sees_none?(stranger.user, owner_user)

    # The stranger writing more doesn't change it.
    reply(stranger, owner, chat)
    assert sees_none?(stranger.user, owner_user)

    # I write back: now they are.
    reply(owner, stranger, chat)
    assert sees_all?(stranger.user, owner_user)
  end

  test "someone I started a chat with is my contact" do
    owner = person("Owner")
    friend = person("Friend")
    owner_user = contacts_only(owner.user)

    {:ok, _chat} = Chats.get_or_create_direct(owner.user, friend.user.id)
    assert sees_all?(friend.user, owner_user)
  end
end
