defmodule Pakchat.Privacy do
  @moduledoc """
  Who may see someone's "online" and "last seen".

  * Last seen: everyone, my contacts (people I have a one-to-one chat with),
    my contacts except some people ("except"), or nobody.
  * Online: everyone, or the same people as last seen.
  * Fair's fair, as in WhatsApp: if you hide your last seen from everyone,
    you can't see other people's either.
  * Someone who blocked you, or whom you blocked, sees neither.
  * Profile photo and About: everyone, my contacts, my contacts except some
    people, or nobody (and not across a block).
  * Groups: who can add me to one, everyone, my contacts, or my contacts except
    some people. Others can't (as on WhatsApp, they can send an invite link instead).
  """
  alias Pakchat.{Accounts, Chats, Presence}
  alias Pakchat.Accounts.User

  @doc "What `viewer` may know about `owner`: `%{online: true | false, last_seen: time | nil}`."
  def presence_for(%User{} = viewer, %User{} = owner) do
    %{
      online: can_see_online?(viewer, owner) and Presence.online?(owner.id),
      last_seen: if(can_see_last_seen?(viewer, owner), do: owner.last_seen_at)
    }
  end

  def can_see_last_seen?(%User{id: id}, %User{id: id}), do: true

  def can_see_last_seen?(%User{} = viewer, %User{} = owner) do
    viewer.last_seen_visibility != "nobody" and
      not Accounts.blocked_between?(viewer.id, owner.id) and
      allowed?(owner.last_seen_visibility, viewer, owner, "last_seen")
  end

  def can_see_online?(%User{id: id}, %User{id: id}), do: true

  def can_see_online?(%User{} = viewer, %User{} = owner) do
    cond do
      hides_online?(viewer) -> false
      Accounts.blocked_between?(viewer.id, owner.id) -> false
      owner.online_visibility == "everyone" -> true
      true -> can_see_last_seen?(viewer, owner)
    end
  end

  @doc "May `viewer` see `owner`'s profile photo?"
  def can_see_photo?(nil, _owner), do: true
  def can_see_photo?(%User{id: id}, %User{id: id}), do: true

  def can_see_photo?(%User{} = viewer, %User{} = owner) do
    not Accounts.blocked_between?(viewer.id, owner.id) and
      allowed?(owner.photo_visibility, viewer, owner, "photo")
  end

  @doc "May `viewer` see `owner`'s About?"
  def can_see_about?(nil, _owner), do: true
  def can_see_about?(%User{id: id}, %User{id: id}), do: true

  def can_see_about?(%User{} = viewer, %User{} = owner) do
    not Accounts.blocked_between?(viewer.id, owner.id) and
      allowed?(owner.about_visibility, viewer, owner, "about")
  end

  @doc "May `adder` add `user` to a group (their Privacy › Groups)?"
  def can_add_to_group?(adder_id, %User{id: adder_id}), do: true

  def can_add_to_group?(adder_id, %User{} = user) do
    case user.groups_visibility do
      "contacts" -> Chats.contacts?(adder_id, user.id)
      "except" -> Chats.contacts?(adder_id, user.id) and not left_out?(user, "groups", adder_id)
      _everyone -> true
    end
  end

  defp hides_online?(user),
    do: user.online_visibility == "same" and user.last_seen_visibility == "nobody"

  defp allowed?("everyone", _viewer, _owner, _key), do: true
  defp allowed?("contacts", viewer, owner, _key), do: Chats.contacts?(viewer.id, owner.id)

  defp allowed?("except", viewer, owner, key),
    do: Chats.contacts?(viewer.id, owner.id) and not left_out?(owner, key, viewer.id)

  defp allowed?(_nobody, _viewer, _owner, _key), do: false

  # Is `who` among the people `owner` left out of this setting?
  defp left_out?(%User{privacy_except: except}, key, who) when is_map(except),
    do: who in Map.get(except, key, [])

  defp left_out?(_owner, _key, _who), do: false
end
