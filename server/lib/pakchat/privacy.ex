defmodule Pakchat.Privacy do
  @moduledoc """
  Who may see someone's "online" and "last seen".

  * Last seen: everyone, my contacts (people I have a one-to-one chat with),
    or nobody.
  * Online: everyone, or the same people as last seen.
  * Fair's fair, as in WhatsApp: if you hide your last seen from everyone,
    you can't see other people's either.
  * Someone who blocked you, or whom you blocked, sees neither.
  * Profile photo and About: everyone, my contacts, or nobody (and not across a block).
  * Groups: who can add me to one, everyone or my contacts. Others can't (as on
    WhatsApp, they can send an invite link instead).
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
      allowed?(owner.last_seen_visibility, viewer, owner)
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
      allowed?(owner.photo_visibility, viewer, owner)
  end

  @doc "May `viewer` see `owner`'s About?"
  def can_see_about?(nil, _owner), do: true
  def can_see_about?(%User{id: id}, %User{id: id}), do: true

  def can_see_about?(%User{} = viewer, %User{} = owner) do
    not Accounts.blocked_between?(viewer.id, owner.id) and
      allowed?(owner.about_visibility, viewer, owner)
  end

  @doc "May `adder` add `user` to a group (their Privacy › Groups)?"
  def can_add_to_group?(adder_id, %User{id: adder_id}), do: true

  def can_add_to_group?(adder_id, %User{} = user) do
    user.groups_visibility != "contacts" or Chats.contacts?(adder_id, user.id)
  end

  defp hides_online?(user),
    do: user.online_visibility == "same" and user.last_seen_visibility == "nobody"

  defp allowed?("everyone", _viewer, _owner), do: true
  defp allowed?("contacts", viewer, owner), do: Chats.contacts?(viewer.id, owner.id)
  defp allowed?(_nobody, _viewer, _owner), do: false
end
