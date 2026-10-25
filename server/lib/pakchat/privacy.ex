defmodule Pakchat.Privacy do
  @moduledoc """
  Who may see someone's "online" and "last seen".

  * Last seen: everyone, my contacts (people I have a one-to-one chat with),
    or nobody.
  * Online: everyone, or the same people as last seen.
  * Fair's fair, as in WhatsApp: if you hide your last seen from everyone,
    you can't see other people's either.
  * Someone who blocked you, or whom you blocked, sees neither.
  * Profile photo: everyone, my contacts, or nobody (and not across a block).
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

  defp hides_online?(user),
    do: user.online_visibility == "same" and user.last_seen_visibility == "nobody"

  defp allowed?("everyone", _viewer, _owner), do: true
  defp allowed?("contacts", viewer, owner), do: Chats.contacts?(viewer.id, owner.id)
  defp allowed?(_nobody, _viewer, _owner), do: false
end
