defmodule PakchatWeb.Wire do
  @moduledoc """
  The shapes the app and the website see, as JSON.

  Bytes (keys, locked messages) travel as base64 text. Field names use
  snake_case, like `device_id`.
  """
  alias Pakchat.Accounts.User
  alias Pakchat.Chats.Chat
  alias Pakchat.Relay.Envelope

  @doc "Me, with my own settings."
  def me(%User{} = u) do
    %{
      id: u.id,
      email: u.email,
      phone: u.phone,
      name: u.name,
      about: u.about,
      photo: u.photo,
      privacy: %{
        last_seen: u.last_seen_visibility,
        online: u.online_visibility,
        photo: u.photo_visibility,
        about: u.about_visibility,
        groups: u.groups_visibility,
        read_receipts: u.read_receipts
      }
    }
  end

  @doc "Someone else: only what anyone may see (their photo and About only if `viewer` may see them)."
  def person(%User{} = u, viewer \\ nil) do
    photo = if Pakchat.Privacy.can_see_photo?(viewer, u), do: u.photo
    about = if Pakchat.Privacy.can_see_about?(viewer, u), do: u.about
    %{id: u.id, name: u.name, about: about, photo: photo}
  end

  @doc "Someone who messaged me first: also how to reach them (see `Chats.reached_out?/2`)."
  def person_with_ways(%User{} = u, viewer \\ nil),
    do: Map.merge(person(u, viewer), %{phone: u.phone, email: u.email})

  def chat(%Chat{} = c, viewer_id) do
    # Someone's status: only its owner sees who else can see it.
    visible =
      if c.kind == "status" and c.created_by != viewer_id,
        do: Enum.filter(c.members, &(&1.user_id in [c.created_by, viewer_id])),
        else: c.members

    members = Enum.map(visible, &%{user_id: &1.user_id, role: &1.role})
    admin? = Enum.any?(c.members, &(&1.user_id == viewer_id and &1.role == "admin"))

    %{
      id: c.id,
      kind: c.kind,
      seq: c.seq,
      members: members
    }
    |> Map.merge(
      if c.kind in ["group", "community"] do
        # Only admins see the invite code, as in today's app. Anyone in a call
        # link's group may share its link.
        sees_invite? = admin? or c.call_link

        %{
          title: c.title,
          description: c.description,
          photo: c.photo,
          only_admins_send: c.only_admins_send,
          invite_code: if(sees_invite?, do: c.invite_code),
          invite_expires_at: if(sees_invite? and c.invite_code, do: c.invite_expires_at),
          invite_max_uses: if(sees_invite? and c.invite_code, do: c.invite_max_uses),
          invite_uses: if(sees_invite? and c.invite_code, do: c.invite_uses),
          community_id: c.community_id,
          announcements: c.announcements,
          call_link: c.call_link,
          groups_by_members: c.groups_by_members,
          join_approval: c.join_approval,
          members_edit: c.members_edit,
          members_add: c.members_add,
          # Whoever made it: a community's owner, the only one who can deactivate it.
          created_by: c.created_by
        }
      else
        %{}
      end
    )
  end

  @doc "A group in a community, as its members see it in the community's list."
  def community_group(%Chat{} = c, viewer_id, requested \\ []) do
    %{
      id: c.id,
      title: c.title,
      description: c.description,
      photo: c.photo,
      announcements: c.announcements,
      members: length(c.members),
      joined: Enum.any?(c.members, &(&1.user_id == viewer_id)),
      approval: c.join_approval,
      requested: c.id in requested
    }
  end

  @doc """
  One envelope. Locked messages come as `body` (base64). Receipts and group
  notes are plain facts the server already knows, so they come as `data`.
  """
  def envelope(%Envelope{} = e) do
    base = %{
      id: e.id,
      chat_id: e.chat_id,
      seq: e.seq,
      from: e.sender_id,
      from_device: e.sender_device,
      kind: e.kind,
      sent_at: e.sent_at
    }

    if e.kind in ["receipt", "system"] do
      Map.put(base, :data, Jason.decode!(e.body))
    else
      Map.merge(base, %{type: e.type, body: Base.encode64(e.body)})
    end
  end

  @doc "A key bundle for one device (see `Pakchat.Keys`)."
  def bundle(b) do
    Map.new(b, fn
      {k, v} when is_binary(v) -> {k, Base.encode64(v)}
      pair -> pair
    end)
  end

  def errors(%Ecto.Changeset{} = changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
