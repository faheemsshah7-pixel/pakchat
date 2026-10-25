defmodule Pakchat.Files do
  @moduledoc """
  Files (photos, videos, voice notes, documents) and backups.

  The phone locks a file with a new random key before uploading it, and puts
  that key inside the (also locked) message. So the server holds bytes it
  can't open, like the envelopes.

  Uploading and downloading use **signed links**: a link that works for a
  few hours and only for one file, so the big bytes don't need the session
  token and can go straight to file storage. For now that storage is a
  folder on the Mac (`FILES_DIR`); at launch it can move to cheap S3-style
  storage without the app changing.

  Attachments are kept 30 days, like messages waiting to be collected.
  Each person keeps one backup, replaced by the next.

  Photos (a person's, a group's or a community's) are kept until replaced.
  Like WhatsApp's, they aren't end-to-end locked: the key travels in the
  `photo` field (`pk1:<id>:<key>:<digest>`), which the server only shows to
  people allowed to see it (see `Pakchat.Privacy`).
  """
  import Ecto.Query
  alias Pakchat.Accounts.User
  alias Pakchat.{Chats, Repo}
  alias Pakchat.Files.File, as: Stored

  @days 30
  # Locking adds a little: a 16-byte start (IV), padding, and a 32-byte check (MAC).
  @overhead 64
  # How long a signed link works, in seconds.
  @link_seconds 6 * 3600

  @doc "The biggest file anyone may send, in bytes (`FILE_MAX_MB`)."
  def max_size, do: Application.get_env(:pakchat, :file_max_mb, 100) * 1024 * 1024

  @doc "The biggest backup, in bytes (`BACKUP_MAX_MB`)."
  def max_backup, do: Application.get_env(:pakchat, :backup_max_mb, 2048) * 1024 * 1024

  @doc "Makes room for a file I'm about to send in a chat. Returns it and where to upload."
  def start_attachment(%User{} = me, chat_id, size) when is_integer(size) and size > 0 do
    cond do
      size > max_size() + @overhead ->
        {:error, :too_big}

      Ecto.UUID.cast(chat_id) == :error or Chats.role(chat_id, me.id) == nil ->
        {:error, :not_found}

      true ->
        %Stored{
          owner_id: me.id,
          chat_id: chat_id,
          kind: "attachment",
          size: size,
          expires_at: DateTime.add(DateTime.utc_now(), @days, :day)
        }
        |> Repo.insert()
    end
  end

  def start_attachment(_, _, _), do: {:error, :bad_request}

  # A photo is small: the phone makes it 640 pixels across first.
  @photo_max 5 * 1024 * 1024

  @doc "Makes room for my new profile photo, or (`chat_id`) a group's or community's I'm an admin of."
  def start_photo(%User{} = me, chat_id, size) when is_integer(size) and size > 0 do
    cond do
      size > @photo_max ->
        {:error, :too_big}

      chat_id != nil and
          (Ecto.UUID.cast(chat_id) == :error or Chats.role(chat_id, me.id) != "admin") ->
        {:error, :not_found}

      true ->
        Repo.insert(%Stored{owner_id: me.id, chat_id: chat_id, kind: "photo", size: size})
    end
  end

  def start_photo(_, _, _), do: {:error, :bad_request}

  @doc "Deletes the file behind a `photo` value that's no longer used (nothing for any other value)."
  def forget_photo("pk1:" <> rest) do
    with [id | _] <- String.split(rest, ":"),
         %Stored{kind: "photo"} <- get(id) do
      from(f in Stored, where: f.id == ^id) |> delete_all()
    end

    :ok
  end

  def forget_photo(_), do: :ok

  @doc "Makes room for my next backup."
  def start_backup(%User{} = me, size) when is_integer(size) and size > 0 do
    if size > max_backup() + @overhead do
      {:error, :too_big}
    else
      Repo.insert(%Stored{owner_id: me.id, kind: "backup", size: size})
    end
  end

  def start_backup(_, _), do: {:error, :bad_request}

  def get(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> Repo.get(Stored, uuid)
      :error -> nil
    end
  end

  @doc """
  Saves an upload. `read.(source)` is called again and again for the next
  piece of the body (`{:more | :ok, data, source}`), so a 100 MB file never
  sits in memory. It must come to exactly the size that was asked for.
  Returns `{result, source}`.
  """
  def receive_upload(%Stored{uploaded: false} = file, source, read) do
    tmp = path(file.id) <> ".part"
    File.mkdir_p!(Path.dirname(tmp))
    {:ok, out} = File.open(tmp, [:write, :binary, :raw])
    {copied, source} = copy(read, source, out, 0, file.size)
    File.close(out)

    case copied do
      {:ok, size} when size == file.size ->
        File.rename!(tmp, path(file.id))
        {:ok, file} = file |> Ecto.Changeset.change(uploaded: true) |> Repo.update()
        if file.kind == "backup", do: delete_older_backups(file)
        {{:ok, file}, source}

      _ ->
        File.rm(tmp)
        {{:error, :bad_upload}, source}
    end
  end

  def receive_upload(_, source, _), do: {{:error, :already_uploaded}, source}

  defp copy(read, source, out, sofar, size) do
    case read.(source) do
      {more_or_done, data, source} when sofar + byte_size(data) <= size ->
        :ok = IO.binwrite(out, data)

        if more_or_done == :more,
          do: copy(read, source, out, sofar + byte_size(data), size),
          else: {{:ok, sofar + byte_size(data)}, source}

      {_, _, source} ->
        {:too_big, source}

      _ ->
        {:error, source}
    end
  end

  @doc "May I download this? Members of the file's chat may; a backup only its owner."
  def can_read?(%Stored{kind: "backup", owner_id: owner}, %User{id: me}), do: owner == me
  # Whoever was shown its `photo` value (which names it) may fetch it, as on WhatsApp.
  def can_read?(%Stored{kind: "photo"}, %User{}), do: true
  def can_read?(%Stored{chat_id: chat_id}, %User{id: me}), do: Chats.role(chat_id, me) != nil

  @doc "My latest backup, if I have one."
  def latest_backup(%User{id: me}) do
    Repo.one(
      from f in Stored,
        where: f.owner_id == ^me and f.kind == "backup" and f.uploaded,
        order_by: [desc: f.inserted_at],
        limit: 1
    )
  end

  def delete_backups(%User{id: me}) do
    from(f in Stored, where: f.owner_id == ^me and f.kind == "backup") |> delete_all()
  end

  defp delete_older_backups(%Stored{} = keep) do
    from(f in Stored,
      where: f.owner_id == ^keep.owner_id and f.kind == "backup" and f.id != ^keep.id
    )
    |> delete_all()
  end

  @doc "Deletes attachments past their 30 days, and uploads that never finished in a day."
  def delete_expired do
    now = DateTime.utc_now()
    day_ago = DateTime.add(now, -1, :day)

    from(f in Stored,
      where: f.expires_at < ^now or (not f.uploaded and f.inserted_at < ^day_ago)
    )
    |> delete_all()
  end

  # Deletes the rows and their bytes. Returns how many.
  defp delete_all(query) do
    ids = Repo.all(select(query, [f], f.id))
    Repo.delete_all(from f in Stored, where: f.id in ^ids)

    for id <- ids do
      File.rm(path(id))
      File.rm(path(id) <> ".part")
    end

    length(ids)
  end

  ## Signed links

  @doc ~s(A link for uploading \("put"\) or downloading \("get"\) one file, for a few hours.)
  def link(%Stored{id: id}, action) when action in ["put", "get"] do
    token = Phoenix.Token.sign(PakchatWeb.Endpoint, "file-" <> action, id)
    %{url: "/api/files/#{id}/data?t=#{token}", expires_in: @link_seconds}
  end

  @doc "Checks a signed link's token. Returns the file, or an error."
  def from_link(id, action, token) when is_binary(token) do
    case Phoenix.Token.verify(PakchatWeb.Endpoint, "file-" <> action, token,
           max_age: @link_seconds
         ) do
      {:ok, ^id} -> get(id) || {:error, :not_found}
      _ -> {:error, :forbidden}
    end
  end

  def from_link(_, _, _), do: {:error, :forbidden}

  @doc "Where a file's bytes are kept."
  def path(id), do: Path.join(dir(), id)

  defp dir, do: Application.get_env(:pakchat, :files_dir, "priv/files")
end
