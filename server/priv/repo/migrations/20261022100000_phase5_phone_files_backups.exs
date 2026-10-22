defmodule Pakchat.Repo.Migrations.Phase5PhoneFilesBackups do
  @moduledoc """
  Phase 5: signing in by phone number, linking Gmail and number into one
  account, finding people from your phone's contacts, files, and backups.

  As before, nothing here can be read by the server: files and backups are
  locked on the phone before they're uploaded, and the server never gets
  their keys.
  """
  use Ecto.Migration

  def change do
    # Someone who signs in by phone may have no Gmail (yet), and the other way round.
    alter table(:users) do
      modify :google_sub, :string, null: true, from: {:string, null: false}
      modify :email, :string, null: true, from: {:string, null: false}
      # SHA-256 of the number and of the Gmail, so a phone can ask "which of my
      # contacts are on PakChat?" by sending hashes instead of the numbers.
      add :phone_hash, :binary
      add :email_hash, :binary
    end

    create unique_index(:users, [:phone_hash])
    create unique_index(:users, [:email_hash])

    # Hashes for the people who signed up before phase 5 (the same SHA-256 the app makes).
    execute(
      "UPDATE users SET email_hash = sha256(convert_to(lower(trim(email)), 'UTF8')) WHERE email IS NOT NULL",
      ""
    )

    # Sign-in codes sent by SMS. Only a hash of the code is kept, for 10 minutes.
    create table(:phone_codes) do
      add :phone, :string, null: false
      # "sign_in" or "link" (adding a number to an account that has one already).
      add :purpose, :string, null: false
      # Empty when the SMS service checks the code itself (Twilio Verify).
      add :code_hash, :binary
      add :tries, :integer, null: false, default: 0
      add :expires_at, :utc_datetime_usec, null: false
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:phone_codes, [:phone, :inserted_at])
    create index(:phone_codes, [:inserted_at])

    # Locked files (photos, videos, voice notes, documents). The bytes live in
    # file storage (a folder on the Mac for now), not in the database.
    create table(:files, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :owner_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      # The chat it was sent in. Only its members can get a download link.
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all)
      # "attachment" or "backup".
      add :kind, :string, null: false, default: "attachment"
      add :size, :bigint, null: false
      add :uploaded, :boolean, null: false, default: false
      add :expires_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:files, [:owner_id, :kind])
    create index(:files, [:expires_at])
  end
end
