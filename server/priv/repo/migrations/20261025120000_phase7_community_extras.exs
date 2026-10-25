defmodule Pakchat.Repo.Migrations.Phase7CommunityExtras do
  @moduledoc """
  Communities like WhatsApp's:
    * `groups_by_members`: anyone in a community may suggest groups for it
      (its admins approve them), not only its admins.
    * `join_approval`: a group's admins approve who joins (from its
      community, or by its invite link).
    * Group suggestions waiting for a community's admins, and requests to
      join a group waiting for its admins.
  """
  use Ecto.Migration

  def change do
    alter table(:chats) do
      add :groups_by_members, :boolean, default: false, null: false
      add :join_approval, :boolean, default: false, null: false
    end

    create table(:community_suggestions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :community_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false
      # One of mine to link in, or (no group) a new group by this name.
      add :group_id, references(:chats, type: :binary_id, on_delete: :delete_all)
      add :title, :string
      add :suggested_by, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:community_suggestions, [:community_id])
    create unique_index(:community_suggestions, [:community_id, :group_id])

    create table(:join_requests, primary_key: false) do
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      timestamps(type: :utc_datetime_usec, updated_at: false)
    end
  end
end
