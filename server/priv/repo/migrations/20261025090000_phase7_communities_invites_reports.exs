defmodule Pakchat.Repo.Migrations.Phase7CommunitiesInvitesReports do
  @moduledoc """
  Phase 7:
    * Communities: a chat of kind "community" holds its members (no messages),
      and groups point to it with `community_id`. Its announcements group is
      the one with `announcements`.
    * Invite links that stop after a time, or after so many people join.
    * Call links: a small group made for a link (`call_link`).
    * Reports: someone reported a chat or a person, with the last few messages
      they chose to send (the server can't read the chat itself).
  """
  use Ecto.Migration

  def change do
    alter table(:chats) do
      add :community_id, references(:chats, type: :binary_id, on_delete: :nilify_all)
      add :announcements, :boolean, default: false, null: false
      add :call_link, :boolean, default: false, null: false
      add :invite_expires_at, :utc_datetime_usec
      add :invite_max_uses, :integer
      add :invite_uses, :integer, default: 0, null: false
    end

    create index(:chats, [:community_id])

    create table(:reports, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :reporter_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :chat_id, references(:chats, type: :binary_id, on_delete: :nilify_all)
      add :user_id, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :reason, :string, null: false
      add :messages, :map, null: false, default: %{}
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:reports, [:reporter_id])
  end
end
