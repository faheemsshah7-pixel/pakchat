defmodule Pakchat.Repo.Migrations.FilesOutliveOwner do
  @moduledoc """
  Deleting an account no longer has to take every file it uploaded with it
  (Pakchat.Files.delete_owned/1): a group's photo stays with the group, and
  photos or documents already sent in a chat stay until their 30 days are up,
  like the messages they belong to. Those files simply have no owner any more.
  """
  use Ecto.Migration

  def change do
    alter table(:files) do
      modify :owner_id, references(:users, type: :binary_id, on_delete: :nilify_all),
        null: true,
        from: {references(:users, type: :binary_id, on_delete: :delete_all), null: false}
    end
  end
end
