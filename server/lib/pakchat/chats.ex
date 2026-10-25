defmodule Pakchat.Chats do
  @moduledoc """
  Chats with one person, and groups: who is in them, admins, invite links,
  and each chat's counter.

  Every group change (someone added, the name changed…) also sends a small
  "system note" to everyone's devices, so they show "Ali added Sara" and
  know the member list changed. The server knows these facts anyway, so
  these notes are not locked.
  """
  import Ecto.Query
  alias Pakchat.Accounts.{Device, User}
  alias Pakchat.Chats.{Chat, JoinRequest, Member, Suggestion}
  alias Pakchat.{Relay, Repo}

  @max_members 1024

  ## Looking chats up

  @doc "All my chats, with their members."
  def list_chats(%User{id: user_id}) do
    Repo.all(
      from c in Chat,
        join: m in Member,
        on: m.chat_id == c.id and m.user_id == ^user_id,
        order_by: [desc: c.updated_at],
        preload: [:members]
    )
  end

  @doc """
  A chat, but only if I'm in it. If I'm not, it's as if it doesn't exist:
  nobody can even find out that a chat id is real.
  """
  def get_chat(%User{id: user_id}, chat_id) do
    with {:ok, uuid} <- cast_id(chat_id),
         %Chat{} = chat <-
           Repo.one(
             from c in Chat,
               join: m in Member,
               on: m.chat_id == c.id and m.user_id == ^user_id,
               where: c.id == ^uuid,
               preload: [:members]
           ) do
      {:ok, chat}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc ~s("admin", "member", or nil if they're not in the chat.)
  def role(chat_id, user_id) do
    Repo.one(
      from m in Member, where: m.chat_id == ^chat_id and m.user_id == ^user_id, select: m.role
    )
  end

  def member_ids(chat_id) do
    Repo.all(from m in Member, where: m.chat_id == ^chat_id, select: m.user_id)
  end

  @doc "Every device of everyone in the chat: `{user_id, device_id, device uuid}`."
  def member_devices(chat_id) do
    Repo.all(
      from d in Device,
        join: m in Member,
        on: m.user_id == d.user_id,
        where: m.chat_id == ^chat_id,
        select: {d.user_id, d.device_id, d.id}
    )
  end

  @doc ~s(Two people are "contacts" if they have a one-to-one chat, as in today's app.)
  def contacts?(a, a), do: true

  def contacts?(a, b) do
    Repo.exists?(from c in Chat, where: c.direct_key == ^direct_key(a, b))
  end

  @doc """
  True when `to` may see how to reach `from` (their number and Gmail), so "Add
  to contacts" can fill them in: `from` started a one-to-one chat with `to`
  (as WhatsApp shows the number of whoever messages you), or `to` started it
  and `from` wrote back.
  """
  def reached_out?(from, to) when from != to do
    Repo.exists?(
      from c in Chat,
        where: c.direct_key == ^direct_key(from, to) and (c.created_by == ^from or c.answered)
    )
  end

  def reached_out?(_, _), do: false

  @doc "The next number on the chat's counter, taken in one step so no two messages share one."
  def next_seq(chat_id) do
    {1, [seq]} =
      Repo.update_all(
        from(c in Chat, where: c.id == ^chat_id, select: c.seq),
        inc: [seq: 1],
        set: [updated_at: DateTime.utc_now()]
      )

    seq
  end

  ## One-to-one chats

  @doc "Opens the chat with someone, making it the first time. Messaging yourself works too."
  def get_or_create_direct(%User{} = me, other_id) do
    with {:ok, other} <- fetch_user(other_id) do
      key = direct_key(me.id, other.id)

      Repo.transaction(fn ->
        chat = Repo.get_by(Chat, direct_key: key) || new_direct(key, me.id, other.id)
        Repo.preload(chat, :members, force: true)
      end)
    end
  end

  defp new_direct(key, me_id, other_id) do
    Repo.insert!(%Chat{kind: "direct", direct_key: key, created_by: me_id},
      on_conflict: :nothing,
      conflict_target: :direct_key
    )

    # Read it back: someone else may have made it at the same moment.
    chat = Repo.get_by!(Chat, direct_key: key)
    add_rows(chat.id, Enum.uniq([me_id, other_id]), "member")
    chat
  end

  defp direct_key(a, b), do: [a, b] |> Enum.sort() |> Enum.join(":")

  ## Groups

  @doc "Makes a group. Whoever makes it is its admin."
  def create_group(%User{} = me, attrs, member_ids) do
    member_ids = Enum.uniq([me.id | List.wrap(member_ids)])

    changeset = Chat.group_changeset(%Chat{kind: "group", created_by: me.id}, attrs)

    with :ok <- check_size(member_ids),
         :ok <- check_users_exist(member_ids),
         :ok <- check_valid(changeset) do
      in_transaction(fn ->
        chat = Repo.insert!(changeset)
        add_rows(chat.id, [me.id], "admin")
        add_rows(chat.id, member_ids -- [me.id], "member")
        notes = note(chat.id, me.id, %{event: "created", title: chat.title, users: member_ids})
        {Repo.preload(chat, :members), notes}
      end)
    end
  end

  defp check_valid(changeset) do
    if changeset.valid?, do: :ok, else: {:error, changeset}
  end

  @doc ~s(Changes the name, description, photo or "only admins can send". Admins only.)
  def update_group(%User{} = me, chat_id, attrs) do
    with {:ok, chat} <- admin_group(me, chat_id),
         changeset = Chat.group_changeset(chat, attrs),
         :ok <- check_valid(changeset) do
      in_transaction(fn ->
        updated = Repo.update!(changeset)
        if Map.has_key?(changeset.changes, :photo), do: Pakchat.Files.forget_photo(chat.photo)

        notes =
          changed_note(updated, changeset, me) ++ rename_announcements(updated, changeset, me)

        {Repo.preload(updated, :members, force: true), notes}
      end)
    end
  end

  # A community's announcements group keeps its name and photo.
  defp rename_announcements(%Chat{kind: "community"} = community, changeset, me) do
    changes = Map.take(changeset.changes, [:title, :photo])

    with true <- changes != %{},
         %Chat{} = group <- announcements_of(community.id) do
      group |> Ecto.Changeset.change(changes) |> Repo.update!()
      note(group.id, me.id, Map.put(changes, :event, "changed"))
    else
      _ -> []
    end
  end

  defp rename_announcements(_chat, _changeset, _me), do: []

  # A note saying what changed, or none if nothing did.
  defp changed_note(_chat, %{changes: changes}, _me) when changes == %{}, do: []

  defp changed_note(chat, changeset, me) do
    note(chat.id, me.id, Map.put(changeset.changes, :event, "changed"))
  end

  @doc "Adds people to a group (or a community). Admins only."
  def add_members(%User{} = me, chat_id, user_ids) do
    with {:ok, chat} <- admin_group(me, chat_id),
         old = Enum.map(chat.members, & &1.user_id),
         new = Enum.uniq(List.wrap(user_ids)) -- old,
         :ok <- check_size(new ++ old),
         :ok <- check_users_exist(new),
         {:ok, _} <- add_and_note(chat, me.id, new, "added") do
      get_chat(me, chat.id)
    end
  end

  # Adds people as members, with a note ("added" or "joined") for everyone.
  # New people in a community join its announcements group too.
  defp add_and_note(_chat, _actor_id, [], _event), do: {:ok, nil}

  defp add_and_note(chat, actor_id, user_ids, event) do
    in_transaction(fn ->
      add_rows(chat.id, user_ids, "member")
      notes = note(chat.id, actor_id, %{event: event, users: user_ids})

      {:ok,
       notes ++
         add_to_announcements(chat, actor_id, user_ids, event) ++
         add_to_community(chat, actor_id, user_ids)}
    end)
  end

  # Someone new in one of a community's groups joins the community too.
  defp add_to_community(
         %Chat{kind: "group", community_id: id, announcements: false},
         actor_id,
         user_ids
       )
       when not is_nil(id) do
    case Repo.get(Chat, id) do
      %Chat{kind: "community"} = community ->
        new = user_ids -- member_ids(community.id)
        add_rows(community.id, new, "member")

        if new == [],
          do: [],
          else:
            note(community.id, actor_id, %{event: "added", users: new}) ++
              add_to_announcements(community, actor_id, new, "added")

      _ ->
        []
    end
  end

  defp add_to_community(_chat, _actor_id, _user_ids), do: []

  defp add_to_announcements(%Chat{kind: "community"} = community, actor_id, user_ids, event) do
    case announcements_of(community.id) do
      nil ->
        []

      group ->
        have = member_ids(group.id)
        new = user_ids -- have
        add_rows(group.id, new, "member")
        if new == [], do: [], else: note(group.id, actor_id, %{event: event, users: new})
    end
  end

  defp add_to_announcements(_chat, _actor_id, _user_ids, _event), do: []

  defp announcements_of(community_id) do
    Repo.one(from c in Chat, where: c.community_id == ^community_id and c.announcements, limit: 1)
  end

  @doc """
  Removes someone from a group. Admins can remove anyone. Anyone can remove
  themselves (leave). If the last admin leaves, the longest-standing member
  becomes admin, so a group always has one.
  """
  def remove_member(%User{} = me, chat_id, user_id) do
    event = if user_id == me.id, do: "left", else: "removed"

    with {:ok, chat} <- get_group(me, chat_id),
         :ok <- allowed_to_remove(chat, me.id, user_id),
         :ok <- not_announcements(chat),
         {:ok, member} <- find_member(chat, user_id) do
      in_transaction(fn ->
        Repo.delete!(member)
        notes = note(chat.id, me.id, %{event: event, users: [user_id]}, [user_id])

        {:ok,
         notes ++
           promote_if_no_admin(chat.id, me.id) ++
           leave_announcements(chat, me.id, user_id, event) ++
           leave_community_groups(chat, me.id, user_id, event)}
      end)
    end
  end

  # Leaving a community (or being removed from it) takes you out of all its groups too, as on WhatsApp.
  defp leave_community_groups(%Chat{kind: "community"} = community, actor_id, user_id, event) do
    groups =
      Repo.all(
        from c in Chat,
          join: m in Member,
          on: m.chat_id == c.id and m.user_id == ^user_id,
          where: c.community_id == ^community.id and not c.announcements
      )

    Enum.flat_map(groups, fn group ->
      Repo.delete_all(from m in Member, where: m.chat_id == ^group.id and m.user_id == ^user_id)

      note(group.id, actor_id, %{event: event, users: [user_id]}, [user_id]) ++
        promote_if_no_admin(group.id, actor_id)
    end)
  end

  defp leave_community_groups(_chat, _actor_id, _user_id, _event), do: []

  # Nobody leaves a community's announcements on its own: they leave the community.
  defp not_announcements(%Chat{announcements: true, community_id: id}) when not is_nil(id),
    do: {:error, :forbidden}

  defp not_announcements(_chat), do: :ok

  defp leave_announcements(%Chat{kind: "community"} = community, actor_id, user_id, event) do
    with %Chat{} = group <- announcements_of(community.id),
         %Member{} = member <- Repo.get_by(Member, chat_id: group.id, user_id: user_id) do
      Repo.delete!(member)
      note(group.id, actor_id, %{event: event, users: [user_id]}, [user_id])
    else
      _ -> []
    end
  end

  defp leave_announcements(_chat, _actor_id, _user_id, _event), do: []

  defp allowed_to_remove(_chat, me_id, me_id), do: :ok
  defp allowed_to_remove(chat, me_id, _), do: require_admin(chat, me_id)

  defp promote_if_no_admin(chat_id, actor_id) do
    admins = from m in Member, where: m.chat_id == ^chat_id and m.role == "admin"

    next =
      Repo.one(from m in Member, where: m.chat_id == ^chat_id, order_by: m.inserted_at, limit: 1)

    if next && not Repo.exists?(admins) do
      set_role(next, "admin")
      note(chat_id, actor_id, %{event: "admin", users: [next.user_id]})
    else
      []
    end
  end

  @doc "Makes someone an admin, or takes it away. Admins only."
  def set_admin(%User{} = me, chat_id, user_id, admin?) do
    {role, event} = if admin?, do: {"admin", "admin"}, else: {"member", "not_admin"}

    with {:ok, chat} <- admin_group(me, chat_id),
         {:ok, member} <- find_member(chat, user_id),
         {:ok, _} <-
           in_transaction(fn ->
             set_role(member, role)
             notes = note(chat.id, me.id, %{event: event, users: [user_id]})

             {:ok,
              notes ++
                promote_if_no_admin(chat.id, me.id) ++
                announcements_role(chat, me.id, user_id, role, event)}
           end) do
      get_chat(me, chat.id)
    end
  end

  # A community's admins are the admins of its announcements, so they can post there.
  defp announcements_role(%Chat{kind: "community"} = community, actor_id, user_id, role, event) do
    with %Chat{} = group <- announcements_of(community.id),
         %Member{} = member <- Repo.get_by(Member, chat_id: group.id, user_id: user_id),
         true <- member.role != role do
      set_role(member, role)
      note(group.id, actor_id, %{event: event, users: [user_id]})
    else
      _ -> []
    end
  end

  defp announcements_role(_chat, _actor_id, _user_id, _role, _event), do: []

  defp find_member(chat, user_id) do
    case Enum.find(chat.members, &(&1.user_id == user_id)) do
      nil -> {:error, :not_found}
      member -> {:ok, member}
    end
  end

  defp set_role(member, role) do
    Repo.update_all(
      from(m in Member, where: m.chat_id == ^member.chat_id and m.user_id == ^member.user_id),
      set: [role: role, updated_at: DateTime.utc_now()]
    )
  end

  ## Status

  @doc """
  Sets who sees my status (my photos, videos and words for 24 hours). Each
  person's status is a chat of its own, kind "status": me, plus everyone
  allowed to see it. It's made the first time. Only I can see who is in it
  (see `PakchatWeb.Wire.chat/2`), and nobody is told they were added or left
  out (no group notes). Unknown ids are skipped.
  """
  def set_status_audience(%User{} = me, user_ids) do
    ids = user_ids |> List.wrap() |> Enum.uniq() |> List.delete(me.id)

    with :ok <- check_size([me.id | ids]) do
      ids = existing_users(ids)

      Repo.transaction(fn ->
        chat = Repo.get_by(Chat, direct_key: status_key(me.id)) || new_status(me.id)

        Repo.delete_all(
          from m in Member,
            where: m.chat_id == ^chat.id and m.user_id != ^me.id and m.user_id not in ^ids
        )

        add_rows(chat.id, ids, "member")
        Repo.preload(chat, :members, force: true)
      end)
    end
  end

  defp status_key(user_id), do: "status:" <> user_id

  defp new_status(user_id) do
    Repo.insert!(%Chat{kind: "status", direct_key: status_key(user_id), created_by: user_id},
      on_conflict: :nothing,
      conflict_target: :direct_key
    )

    chat = Repo.get_by!(Chat, direct_key: status_key(user_id))
    add_rows(chat.id, [user_id], "admin")
    chat
  end

  defp existing_users([]), do: []

  defp existing_users(ids) do
    uuids = for id <- ids, {:ok, uuid} <- [Ecto.UUID.cast(id)], do: uuid
    Repo.all(from u in User, where: u.id in ^uuids, select: u.id)
  end

  ## Invite links

  @doc """
  Makes a new invite link for a group or community (the old one stops
  working). Admins only. `opts`: `expires_in` (seconds) and `max_uses`, so
  the link stops after a time or once that many people have joined with it.
  """
  def reset_invite(%User{} = me, chat_id, opts \\ %{}) do
    with {:ok, chat} <- admin_group(me, chat_id),
         {:ok, expires_at, max_uses} <- invite_limits(opts) do
      # 16 random bytes: far too many to guess.
      code = Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)

      chat
      |> Ecto.Changeset.change(
        invite_code: code,
        invite_expires_at: expires_at,
        invite_max_uses: max_uses,
        invite_uses: 0
      )
      |> Repo.update!()

      {:ok, %{code: code, expires_at: expires_at, max_uses: max_uses}}
    end
  end

  # Up to 30 days, and up to 1024 people.
  defp invite_limits(opts) do
    expires_in = opts["expires_in"] || opts[:expires_in]
    max_uses = opts["max_uses"] || opts[:max_uses]

    cond do
      expires_in != nil and not (is_integer(expires_in) and expires_in in 60..(30 * 86_400)) ->
        {:error, :bad_request}

      max_uses != nil and not (is_integer(max_uses) and max_uses in 1..@max_members) ->
        {:error, :bad_request}

      true ->
        expires_at = if expires_in, do: DateTime.add(DateTime.utc_now(), expires_in, :second)
        {:ok, expires_at, max_uses}
    end
  end

  @doc "Turns a group's invite link off. Admins only."
  def remove_invite(%User{} = me, chat_id) do
    with {:ok, chat} <- admin_group(me, chat_id) do
      chat |> Ecto.Changeset.change(invite_code: nil) |> Repo.update!()
      :ok
    end
  end

  @doc ~s(The group behind an invite code, for the "Join group?" screen.)
  def get_by_invite(code) do
    with {:ok, chat} <- any_invite(code) do
      if invite_open?(chat), do: {:ok, chat}, else: {:error, :not_found}
    end
  end

  defp any_invite(code) when is_binary(code) do
    query = from c in Chat, where: c.invite_code == ^code and c.kind in ["group", "community"]

    case Repo.one(query) do
      nil -> {:error, :not_found}
      chat -> {:ok, Repo.preload(chat, :members)}
    end
  end

  defp any_invite(_), do: {:error, :not_found}

  # A link that ran out of time or of places looks just like one that never was.
  defp invite_open?(chat) do
    in_time? =
      is_nil(chat.invite_expires_at) or
        DateTime.after?(chat.invite_expires_at, DateTime.utc_now())

    room? = is_nil(chat.invite_max_uses) or chat.invite_uses < chat.invite_max_uses
    in_time? and room?
  end

  def join_by_invite(%User{} = me, code) do
    with {:ok, chat} <- any_invite(code) do
      # Someone already in it just opens it, even once the link has run out.
      if Enum.any?(chat.members, &(&1.user_id == me.id)),
        do: get_chat(me, chat.id),
        else: join_new(me, code)
    end
  end

  defp join_new(me, code) do
    case get_by_invite(code) do
      # Its admins approve who joins: ask them instead.
      {:ok, %Chat{kind: "group", join_approval: true} = chat} -> request_to_join(me, chat)
      _ -> join_by_link(me, code)
    end
  end

  defp join_by_link(me, code) do
    with {:ok, chat} <- get_by_invite(code),
         old = Enum.map(chat.members, & &1.user_id),
         :ok <- check_size([me.id | old]),
         :ok <- use_invite(chat),
         {:ok, _} <- add_and_note(chat, me.id, [me.id], "joined") do
      get_chat(me, chat.id)
    end
  end

  # Counts a join (someone already in it never gets here). Taken in one step, so
  # two people can't both get the last place.
  defp use_invite(chat) do
    query =
      from c in Chat,
        where: c.id == ^chat.id and c.invite_code == ^chat.invite_code,
        where: is_nil(c.invite_max_uses) or c.invite_uses < c.invite_max_uses

    case Repo.update_all(query, inc: [invite_uses: 1]) do
      {1, _} -> :ok
      _ -> {:error, :not_found}
    end
  end

  ## Communities

  @doc """
  Makes a community: its own member list (me as admin), an announcements
  group where only admins post, and any of my groups (ones I'm admin of)
  linked in. Everyone in those groups joins the community too, as on WhatsApp.
  """
  def create_community(%User{} = me, attrs, group_ids) do
    changeset = Chat.group_changeset(%Chat{kind: "community", created_by: me.id}, attrs)

    with :ok <- check_valid(changeset),
         {:ok, groups} <- my_free_groups(me, List.wrap(group_ids)) do
      in_transaction(fn ->
        community = Repo.insert!(changeset)
        add_rows(community.id, [me.id], "admin")

        announcements =
          Repo.insert!(%Chat{
            kind: "group",
            created_by: me.id,
            title: community.title,
            photo: community.photo,
            only_admins_send: true,
            announcements: true,
            community_id: community.id
          })

        add_rows(announcements.id, [me.id], "admin")

        notes =
          note(community.id, me.id, %{event: "created", title: community.title, users: [me.id]}) ++
            note(announcements.id, me.id, %{
              event: "created",
              title: community.title,
              users: [me.id]
            }) ++
            Enum.flat_map(groups, &link_one(community, &1, me.id))

        {Repo.preload(community, :members, force: true), notes}
      end)
    end
  end

  # Groups I'm an admin of that aren't in a community yet.
  defp my_free_groups(me, ids) do
    Enum.reduce_while(ids, {:ok, []}, fn id, {:ok, acc} ->
      case admin_group(me, id) do
        {:ok, %Chat{kind: "group", community_id: nil, call_link: false} = g} ->
          {:cont, {:ok, [g | acc]}}

        {:ok, _} ->
          {:halt, {:error, :forbidden}}

        error ->
          {:halt, error}
      end
    end)
  end

  # Links a group into a community; its people join the community.
  defp link_one(community, group, actor_id) do
    group |> Ecto.Changeset.change(community_id: community.id) |> Repo.update!()
    have = member_ids(community.id)
    new = Enum.map(group.members, & &1.user_id) -- have
    add_rows(community.id, new, "member")

    note(group.id, actor_id, %{
      event: "community",
      title: community.title,
      community_id: community.id
    }) ++
      if(new == [], do: [], else: note(community.id, actor_id, %{event: "added", users: new})) ++
      add_to_announcements(community, actor_id, new, "added")
  end

  @doc "The groups in a community, for its members."
  def community_groups(%User{} = me, community_id) do
    with {:ok, community} <- get_community(me, community_id) do
      groups =
        Repo.all(
          from c in Chat,
            where: c.community_id == ^community.id,
            order_by: [desc: c.announcements, asc: c.title],
            preload: [:members]
        )

      requested =
        Repo.all(
          from r in JoinRequest,
            where: r.user_id == ^me.id and r.chat_id in ^Enum.map(groups, & &1.id),
            select: r.chat_id
        )

      {:ok, community, groups, requested}
    end
  end

  @doc "Links my groups into a community, or (`attrs` with a title) makes a new one in it. Community admins only."
  def add_community_groups(%User{} = me, community_id, group_ids, attrs \\ nil) do
    with {:ok, community} <- get_community(me, community_id),
         :ok <- require_admin(community, me.id),
         {:ok, groups} <- my_free_groups(me, List.wrap(group_ids)) do
      in_transaction(fn ->
        made =
          if attrs do
            changeset =
              Chat.group_changeset(
                %Chat{kind: "group", created_by: me.id, community_id: community.id},
                attrs
              )

            if changeset.valid?, do: Repo.insert!(changeset), else: Repo.rollback(changeset)
          end

        made_notes =
          if made do
            add_rows(made.id, [me.id], "admin")
            note(made.id, me.id, %{event: "created", title: made.title, users: [me.id]})
          else
            []
          end

        notes = made_notes ++ Enum.flat_map(groups, &link_one(community, &1, me.id))
        {made && made.id, notes}
      end)
    end
  end

  @doc "Takes a group out of a community (not its announcements). Community admins only."
  def remove_community_group(%User{} = me, community_id, group_id) do
    with {:ok, community} <- get_community(me, community_id),
         :ok <- require_admin(community, me.id),
         {:ok, gid} <- cast_id(group_id),
         %Chat{announcements: false} = group <-
           Repo.get_by(Chat, id: gid, community_id: community.id) do
      in_transaction(fn ->
        group |> Ecto.Changeset.change(community_id: nil) |> Repo.update!()
        {:ok, note(group.id, me.id, %{event: "community_left", title: community.title})}
      end)
    else
      %Chat{} -> {:error, :forbidden}
      nil -> {:error, :not_found}
      error -> error
    end
  end

  @doc """
  Joins one of a community's groups straight away, or, when its admins
  approve who joins, asks them (answers `{:ok, :requested}`).
  """
  def join_community_group(%User{} = me, community_id, group_id) do
    with {:ok, community} <- get_community(me, community_id),
         {:ok, gid} <- cast_id(group_id),
         %Chat{} = group <- Repo.get_by(Chat, id: gid, community_id: community.id) do
      group = Repo.preload(group, :members)

      if group.join_approval and not Enum.any?(group.members, &(&1.user_id == me.id)),
        do: request_to_join(me, group),
        else: join_now(me, group)
    else
      nil -> {:error, :not_found}
      error -> error
    end
  end

  defp join_now(me, group) do
    old = Enum.map(group.members, & &1.user_id)
    new = [me.id] -- old

    with :ok <- check_size(new ++ old),
         {:ok, _} <- add_and_note(group, me.id, new, "joined") do
      get_chat(me, group.id)
    end
  end

  # Asks a group's admins to let me in. They hear about it (a note), and see it in the group's info.
  defp request_to_join(me, group) do
    in_transaction(fn ->
      Repo.insert!(%JoinRequest{chat_id: group.id, user_id: me.id},
        on_conflict: :nothing,
        conflict_target: [:chat_id, :user_id]
      )

      {:requested, note(group.id, me.id, %{event: "requested", users: [me.id]})}
    end)
  end

  @doc "Takes back my request to join a group."
  def cancel_join_request(%User{} = me, group_id) do
    with {:ok, gid} <- cast_id(group_id) do
      Repo.delete_all(from r in JoinRequest, where: r.chat_id == ^gid and r.user_id == ^me.id)
      :ok
    end
  end

  @doc "Who is asking to join a group, oldest first. Its admins only."
  def join_requests(%User{} = me, group_id) do
    with {:ok, group} <- admin_group(me, group_id) do
      {:ok,
       Repo.all(
         from r in JoinRequest,
           where: r.chat_id == ^group.id,
           order_by: r.inserted_at,
           select: %{user_id: r.user_id, at: r.inserted_at}
       )}
    end
  end

  @doc "Lets someone in (`true`), or says no. The group's admins only."
  def answer_join_request(%User{} = me, group_id, user_id, yes?) do
    with {:ok, group} <- admin_group(me, group_id),
         {:ok, uid} <- cast_id(user_id),
         %JoinRequest{} = request <- Repo.get_by(JoinRequest, chat_id: group.id, user_id: uid) do
      Repo.delete!(request)
      if yes?, do: let_in(me, group, uid), else: said_no(me, group, uid)
    else
      nil -> {:error, :not_found}
      error -> error
    end
  end

  defp let_in(me, group, user_id) do
    old = Enum.map(group.members, & &1.user_id)

    with :ok <- check_size([user_id | old]),
         {:ok, _} <- add_and_note(group, me.id, [user_id] -- old, "added"),
         do: :ok
  end

  # The other admins' lists update; nobody is told the answer was no (as on WhatsApp).
  defp said_no(me, group, user_id) do
    with {:ok, _} <-
           in_transaction(fn ->
             {:ok, note(group.id, me.id, %{event: "request_done", users: [user_id]})}
           end),
         do: :ok
  end

  @doc """
  Suggests groups for a community: ones of mine (I'm their admin), or a new
  group by a name (`title`). Anyone in it may when its admins allow it; its
  admins approve each one.
  """
  def suggest_community_groups(%User{} = me, community_id, group_ids, title) do
    with {:ok, community} <- get_community(me, community_id),
         :ok <- may_suggest(community, me.id),
         :ok <- check_title(title),
         {:ok, groups} <- my_free_groups(me, List.wrap(group_ids)),
         rows =
           Enum.map(groups, &%{group_id: &1.id, title: nil}) ++
             List.wrap(title && %{group_id: nil, title: title}),
         true <- rows != [] || {:error, :bad_request} do
      in_transaction(fn ->
        Enum.each(rows, fn row ->
          Repo.insert!(
            struct(
              Suggestion,
              Map.merge(row, %{community_id: community.id, suggested_by: me.id})
            ),
            on_conflict: :nothing,
            conflict_target: [:community_id, :group_id]
          )
        end)

        {:ok, note(community.id, me.id, %{event: "suggested", users: [me.id]})}
      end)
    end
  end

  defp may_suggest(%Chat{groups_by_members: true}, _user_id), do: :ok
  defp may_suggest(community, user_id), do: require_admin(community, user_id)

  defp check_title(nil), do: :ok
  defp check_title(title) when is_binary(title) and byte_size(title) in 1..100, do: :ok
  defp check_title(_), do: {:error, :bad_request}

  @doc "The groups waiting for a community's admins: all of them for its admins, my own for anyone else."
  def community_suggestions(%User{} = me, community_id) do
    with {:ok, community} <- get_community(me, community_id) do
      query =
        from s in Suggestion, where: s.community_id == ^community.id, order_by: s.inserted_at

      query =
        if require_admin(community, me.id) == :ok,
          do: query,
          else: from(s in query, where: s.suggested_by == ^me.id)

      list = Repo.all(query)
      ids = for %{group_id: id} when not is_nil(id) <- list, do: id

      groups =
        Repo.all(from c in Chat, where: c.id in ^ids, preload: [:members])
        |> Map.new(&{&1.id, &1})

      {:ok, Enum.map(list, &{&1, groups[&1.group_id]})}
    end
  end

  @doc "Approves a suggested group: it's linked in, or made (its suggester its admin). The community's admins only."
  def approve_suggestion(%User{} = me, community_id, suggestion_id) do
    with {:ok, community} <- get_community(me, community_id),
         :ok <- require_admin(community, me.id),
         {:ok, sid} <- cast_id(suggestion_id),
         %Suggestion{} = s <- Repo.get_by(Suggestion, id: sid, community_id: community.id) do
      in_transaction(fn ->
        Repo.delete!(s)

        {:ok,
         approved(community, s, me.id) ++
           note(community.id, me.id, %{event: "suggestion_done", users: [s.suggested_by]})}
      end)
    else
      nil -> {:error, :not_found}
      error -> error
    end
  end

  defp approved(community, %Suggestion{group_id: nil} = s, _actor_id) do
    made =
      Repo.insert!(%Chat{
        kind: "group",
        created_by: s.suggested_by,
        community_id: community.id,
        title: s.title
      })

    add_rows(made.id, [s.suggested_by], "admin")
    note(made.id, s.suggested_by, %{event: "created", title: made.title, users: [s.suggested_by]})
  end

  defp approved(community, s, actor_id) do
    case Repo.preload(Repo.get(Chat, s.group_id), :members) do
      %Chat{kind: "group", community_id: nil, call_link: false} = group ->
        link_one(community, group, actor_id)

      _ ->
        Repo.rollback(:not_found)
    end
  end

  @doc "Says no to a suggested group (the community's admins), or takes mine back."
  def drop_suggestion(%User{} = me, community_id, suggestion_id) do
    with {:ok, community} <- get_community(me, community_id),
         {:ok, sid} <- cast_id(suggestion_id),
         %Suggestion{} = s <- Repo.get_by(Suggestion, id: sid, community_id: community.id),
         :ok <- if(s.suggested_by == me.id, do: :ok, else: require_admin(community, me.id)) do
      in_transaction(fn ->
        Repo.delete!(s)
        {:ok, note(community.id, me.id, %{event: "suggestion_done", users: [s.suggested_by]})}
      end)
    else
      nil -> {:error, :not_found}
      error -> error
    end
  end

  @doc """
  Deactivates a community, as WhatsApp's owner can: its groups go on, on
  their own; its announcements and its member list end. Its owner only.
  """
  def deactivate_community(%User{} = me, community_id) do
    with {:ok, community} <- get_community(me, community_id),
         true <- community.created_by == me.id || {:error, :forbidden} do
      in_transaction(fn ->
        groups = Repo.all(from c in Chat, where: c.community_id == ^community.id)

        group_notes =
          Enum.flat_map(groups, fn group ->
            group |> Ecto.Changeset.change(community_id: nil) |> Repo.update!()
            unlink_note(group, community, me.id)
          end)

        everyone = member_ids(community.id)
        Repo.delete_all(from m in Member, where: m.chat_id == ^community.id)
        Repo.delete_all(from s in Suggestion, where: s.community_id == ^community.id)

        {:ok,
         group_notes ++
           note(community.id, me.id, %{event: "deactivated", title: community.title}, everyone)}
      end)
    end
  end

  # Its announcements end for everyone; any other group just leaves the community.
  defp unlink_note(%Chat{announcements: true} = group, community, actor_id) do
    everyone = member_ids(group.id)
    Repo.delete_all(from m in Member, where: m.chat_id == ^group.id)
    note(group.id, actor_id, %{event: "deactivated", title: community.title}, everyone)
  end

  defp unlink_note(group, community, actor_id) do
    note(group.id, actor_id, %{event: "community_left", title: community.title})
  end

  defp get_community(me, id) do
    case get_chat(me, id) do
      {:ok, %Chat{kind: "community"} = c} -> {:ok, c}
      _ -> {:error, :not_found}
    end
  end

  ## Call links

  @doc "A call link: a small group for it, with a link anyone can open to join its call."
  def create_call_link(%User{} = me, attrs) do
    changeset =
      Chat.group_changeset(%Chat{kind: "group", created_by: me.id, call_link: true}, attrs)

    code = Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)

    with :ok <- check_valid(changeset) do
      in_transaction(fn ->
        chat = Repo.insert!(Ecto.Changeset.change(changeset, invite_code: code))
        add_rows(chat.id, [me.id], "admin")
        {Repo.preload(chat, :members), []}
      end)
    end
  end

  ## Helpers

  # A group, or a community (its members, admins, name and invite link work the same way).
  defp get_group(me, chat_id) do
    case get_chat(me, chat_id) do
      {:ok, %Chat{kind: kind} = chat} when kind in ["group", "community"] -> {:ok, chat}
      _ -> {:error, :not_found}
    end
  end

  defp admin_group(me, chat_id) do
    with {:ok, chat} <- get_group(me, chat_id), :ok <- require_admin(chat, me.id) do
      {:ok, chat}
    end
  end

  defp require_admin(chat, user_id) do
    if Enum.any?(chat.members, &(&1.user_id == user_id and &1.role == "admin")),
      do: :ok,
      else: {:error, :forbidden}
  end

  defp add_rows(chat_id, user_ids, role) do
    now = DateTime.utc_now()

    rows =
      Enum.map(user_ids, fn id ->
        %{chat_id: chat_id, user_id: id, role: role, inserted_at: now, updated_at: now}
      end)

    Repo.insert_all(Member, rows, on_conflict: :nothing)
  end

  defp check_size(ids) do
    if length(ids) <= @max_members, do: :ok, else: {:error, :group_full}
  end

  defp check_users_exist(ids) do
    with {:ok, uuids} <- cast_ids(ids) do
      found = Repo.aggregate(from(u in User, where: u.id in ^uuids), :count)
      if found == length(Enum.uniq(uuids)), do: :ok, else: {:error, :not_found}
    end
  end

  defp fetch_user(id) do
    with {:ok, uuid} <- cast_id(id), %User{} = user <- Repo.get(User, uuid) do
      {:ok, user}
    else
      _ -> {:error, :not_found}
    end
  end

  defp cast_id(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :not_found}
    end
  end

  defp cast_ids(ids) do
    Enum.reduce_while(ids, {:ok, []}, fn id, {:ok, acc} ->
      case cast_id(id) do
        {:ok, uuid} -> {:cont, {:ok, [uuid | acc]}}
        error -> {:halt, error}
      end
    end)
  end

  # Saves a group note for every member's devices (and for `extra_user_ids`,
  # such as someone who was just removed, so they find out too).
  defp note(chat_id, actor_id, data, extra_user_ids \\ []) do
    Relay.store_system_note(chat_id, actor_id, data, extra_user_ids)
  end

  # Runs `fun` as one database transaction: all of it is saved, or none of it.
  # `fun` returns `{result, notes}`. The notes are pushed to devices only once
  # everything is saved, so no device hears about a change that then fails.
  defp in_transaction(fun) do
    case Repo.transaction(fun) do
      {:ok, {result, notes}} ->
        Relay.deliver(notes)
        {:ok, result}

      error ->
        error
    end
  end
end
