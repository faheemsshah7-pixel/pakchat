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
  alias Pakchat.Chats.{Chat, Member}
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
        notes = changed_note(updated, changeset, me)
        {Repo.preload(updated, :members, force: true), notes}
      end)
    end
  end

  # A note saying what changed, or none if nothing did.
  defp changed_note(_chat, %{changes: changes}, _me) when changes == %{}, do: []

  defp changed_note(chat, changeset, me) do
    note(chat.id, me.id, Map.put(changeset.changes, :event, "changed"))
  end

  @doc "Adds people to a group. Admins only."
  def add_members(%User{} = me, chat_id, user_ids) do
    with {:ok, chat} <- admin_group(me, chat_id),
         old = Enum.map(chat.members, & &1.user_id),
         new = Enum.uniq(List.wrap(user_ids)) -- old,
         :ok <- check_size(new ++ old),
         :ok <- check_users_exist(new),
         {:ok, _} <- add_and_note(chat.id, me.id, new, "added") do
      get_chat(me, chat.id)
    end
  end

  # Adds people as members, with a note ("added" or "joined") for everyone.
  defp add_and_note(_chat_id, _actor_id, [], _event), do: {:ok, nil}

  defp add_and_note(chat_id, actor_id, user_ids, event) do
    in_transaction(fn ->
      add_rows(chat_id, user_ids, "member")
      {:ok, note(chat_id, actor_id, %{event: event, users: user_ids})}
    end)
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
         {:ok, member} <- find_member(chat, user_id) do
      in_transaction(fn ->
        Repo.delete!(member)
        notes = note(chat.id, me.id, %{event: event, users: [user_id]}, [user_id])
        {:ok, notes ++ promote_if_no_admin(chat.id, me.id)}
      end)
    end
  end

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
             {:ok, notes ++ promote_if_no_admin(chat.id, me.id)}
           end) do
      get_chat(me, chat.id)
    end
  end

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

  ## Invite links

  @doc "Makes a new invite link for a group (the old one stops working). Admins only."
  def reset_invite(%User{} = me, chat_id) do
    with {:ok, chat} <- admin_group(me, chat_id) do
      # 16 random bytes: far too many to guess.
      code = Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)
      chat |> Ecto.Changeset.change(invite_code: code) |> Repo.update!()
      {:ok, code}
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
  def get_by_invite(code) when is_binary(code) do
    case Repo.get_by(Chat, invite_code: code, kind: "group") do
      nil -> {:error, :not_found}
      chat -> {:ok, Repo.preload(chat, :members)}
    end
  end

  def get_by_invite(_), do: {:error, :not_found}

  def join_by_invite(%User{} = me, code) do
    with {:ok, chat} <- get_by_invite(code),
         old = Enum.map(chat.members, & &1.user_id),
         new = [me.id] -- old,
         :ok <- check_size(new ++ old),
         {:ok, _} <- add_and_note(chat.id, me.id, new, "joined") do
      get_chat(me, chat.id)
    end
  end

  ## Helpers

  defp get_group(me, chat_id) do
    case get_chat(me, chat_id) do
      {:ok, %Chat{kind: "group"} = chat} -> {:ok, chat}
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
