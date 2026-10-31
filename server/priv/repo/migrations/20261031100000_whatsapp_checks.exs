defmodule Pakchat.Repo.Migrations.WhatsappChecks do
  @moduledoc """
  Checking a phone number with WhatsApp: the app shows a short code, the person
  sends it to PakChat's WhatsApp number, and Meta tells us which number sent it
  (see Pakchat.WhatsApp). One row per check, kept for 10 minutes.
  """
  use Ecto.Migration

  def change do
    create table(:whatsapp_checks, primary_key: false) do
      add :id, :binary_id, primary_key: true
      # The code in the message, like "K7M4QX". Only unique among checks still waiting.
      add :code, :string, null: false
      # SHA-256 of the secret only the app that started the check holds.
      add :secret_hash, :binary, null: false
      # "sign_in" or "link".
      add :purpose, :string, null: false
      # The number that sent the code, once it has.
      add :phone, :string
      add :expires_at, :utc_datetime_usec, null: false
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:whatsapp_checks, [:code])
    create index(:whatsapp_checks, [:inserted_at])
  end
end
