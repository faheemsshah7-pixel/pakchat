defmodule Pakchat.Repo.Migrations.TwoStepPin do
  @moduledoc """
  Two-step verification, like WhatsApp: a 6-digit PIN asked when the account
  signs in on a new phone. Only a scrambled copy is kept (Pakchat.Pin). Wrong
  tries are counted here, so a new install can't start the count again.
  `pin_reset_at`: when "Forgot PIN? Wait 7 days" was asked.
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :pin_hash, :string
      add :pin_failures, :integer, null: false, default: 0
      add :pin_locked_until, :utc_datetime
      add :pin_reset_at, :utc_datetime
    end
  end
end
