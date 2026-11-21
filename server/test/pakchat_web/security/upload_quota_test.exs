defmodule PakchatWeb.Security.UploadQuotaTest do
  @moduledoc """
  One script must not fill the disk: photos check the disk like other files,
  and each person has a daily limit on new photos, files and backups.
  """
  # Not async: it changes the limits for a moment.
  use Pakchat.DataCase, async: false
  import Pakchat.Fixtures
  import Ecto.Query
  alias Pakchat.{Chats, Files}

  setup do
    saved = Application.get_all_env(:pakchat)

    on_exit(fn ->
      for key <- [:min_free_mb, :upload_day_mb, :photos_per_day, :backups_per_day] do
        case Keyword.fetch(saved, key) do
          {:ok, v} -> Application.put_env(:pakchat, key, v)
          :error -> Application.delete_env(:pakchat, key)
        end
      end
    end)

    ali = person("Ali")
    sara = person("Sara")
    {:ok, chat} = Chats.get_or_create_direct(ali.user, sara.user.id)
    %{ali: ali.user, chat: chat}
  end

  test "a photo is refused when the disk is nearly full", %{ali: ali} do
    Application.put_env(:pakchat, :min_free_mb, 1_000_000_000)
    assert {:error, :storage_full} = Files.start_photo(ali, nil, 1000)
  end

  test "photos: only so many new ones a day", %{ali: ali} do
    Application.put_env(:pakchat, :photos_per_day, 3)
    for _ <- 1..3, do: assert({:ok, _} = Files.start_photo(ali, nil, 1000))
    assert {:error, :quota_full} = Files.start_photo(ali, nil, 1000)
  end

  test "files: only so many bytes a day per person", %{ali: ali, chat: chat} do
    Application.put_env(:pakchat, :upload_day_mb, 2)
    assert {:ok, _} = Files.start_attachment(ali, chat.id, 1024 * 1024)
    assert {:ok, _} = Files.start_attachment(ali, chat.id, 900 * 1024)
    assert {:error, :quota_full} = Files.start_attachment(ali, chat.id, 200 * 1024)
  end

  test "backups: only a few a day", %{ali: ali} do
    Application.put_env(:pakchat, :backups_per_day, 2)
    for _ <- 1..2, do: assert({:ok, _} = Files.start_backup(ali, 1000))
    assert {:error, :quota_full} = Files.start_backup(ali, 1000)
  end

  test "photos nobody uses are cleaned after a day; used ones stay", %{ali: ali} do
    {:ok, unused} = Files.start_photo(ali, nil, 1000)
    {:ok, used} = Files.start_photo(ali, nil, 1000)
    day_ago = DateTime.add(DateTime.utc_now(), -2, :day)

    Pakchat.Repo.update_all(from(f in Pakchat.Files.File, where: f.id in ^[unused.id, used.id]),
      set: [uploaded: true, inserted_at: day_ago]
    )

    {:ok, _} = Pakchat.Accounts.update_profile(ali, %{"photo" => "pk1:#{used.id}:k:d"})
    Files.delete_expired()
    refute Files.get(unused.id)
    assert Files.get(used.id)
  end
end
