defmodule Pakchat.Repo.Migrations.CreateRelayTables do
  @moduledoc """
  Every table the relay needs, made in one go.

  Look at what is *not* here: no message text, no captions, no file keys.
  The only chat content the server ever holds is `pending_envelopes.body`,
  which is locked bytes it cannot open, and only until the device collects it.
  """
  use Ecto.Migration

  def change do
    # People. Gmail (and later a phone number) is how others find you.
    create table(:users, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :google_sub, :string, null: false
      add :email, :string, null: false
      add :phone, :string
      add :name, :string, null: false
      add :about, :string, null: false, default: "Hey there! I am using PakChat."
      add :photo, :string
      # Privacy: who sees your last seen and online, and whether blue ticks are on.
      add :last_seen_visibility, :string, null: false, default: "everyone"
      add :online_visibility, :string, null: false, default: "everyone"
      add :read_receipts, :boolean, null: false, default: true
      add :last_seen_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:users, [:google_sub])
    create unique_index(:users, [:email])
    create unique_index(:users, [:phone])

    # Each phone or linked website. Only public keys are stored.
    create table(:devices, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      # Signal's own number for the device: 1 is the phone, 2 and up are linked devices.
      add :device_id, :integer, null: false
      add :name, :string, null: false, default: "Phone"
      # We keep a fingerprint (hash) of the session token, never the token itself.
      add :token_hash, :binary, null: false
      add :registration_id, :integer, null: false
      add :identity_key, :binary, null: false
      add :signed_pre_key_id, :integer, null: false
      add :signed_pre_key, :binary, null: false
      add :signed_pre_key_signature, :binary, null: false
      # Used when the one-time Kyber keys run out.
      add :kyber_last_resort_id, :integer, null: false
      add :kyber_last_resort_key, :binary, null: false
      add :kyber_last_resort_signature, :binary, null: false
      add :push_token, :string
      add :push_platform, :string
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:devices, [:user_id, :device_id])
    create unique_index(:devices, [:token_hash])

    # One-time pre-keys. Each one is handed out once, then deleted.
    create table(:pre_keys) do
      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      # "ec" (the classic kind) or "kyber" (the post-quantum kind, which has a signature).
      add :kind, :string, null: false
      add :key_id, :integer, null: false
      add :public_key, :binary, null: false
      add :signature, :binary
    end

    create unique_index(:pre_keys, [:device_id, :kind, :key_id])

    # Chats with one person (kind "direct") and groups (kind "group").
    create table(:chats, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :kind, :string, null: false
      # For one-to-one chats: both people's ids, sorted, so a pair only ever has one chat.
      add :direct_key, :string
      add :title, :string
      add :description, :text
      add :photo, :string
      add :only_admins_send, :boolean, null: false, default: false
      add :invite_code, :string
      # The chat's counter. Every message gets the next number.
      add :seq, :bigint, null: false, default: 0
      add :created_by, references(:users, type: :binary_id, on_delete: :nilify_all)
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:chats, [:direct_key])
    create unique_index(:chats, [:invite_code])

    create table(:chat_members, primary_key: false) do
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      # "admin" or "member".
      add :role, :string, null: false, default: "member"
      timestamps(type: :utc_datetime_usec)
    end

    create index(:chat_members, [:user_id])

    # Locked messages waiting for a device. Deleted once the device has them,
    # or after 30 days if it never comes back.
    create table(:pending_envelopes) do
      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false

      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false
      # The chat's counter for this message. Empty for receipts.
      add :seq, :bigint
      add :sender_id, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :sender_device, :integer
      # "message", "reaction", "receipt" or "system".
      add :kind, :string, null: false
      # The Signal message type (2, 3 or 7), or 0 for receipts and system notes.
      add :type, :integer, null: false
      add :body, :binary, null: false
      add :sent_at, :utc_datetime_usec, null: false
      add :expires_at, :utc_datetime_usec, null: false
    end

    create index(:pending_envelopes, [:device_id, :id])
    create index(:pending_envelopes, [:device_id, :chat_id, :seq])
    create index(:pending_envelopes, [:expires_at])

    # Who has blocked whom.
    create table(:blocks, primary_key: false) do
      add :blocker_id, references(:users, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :blocked_id, references(:users, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      timestamps(type: :utc_datetime_usec, updated_at: false)
    end
  end
end
