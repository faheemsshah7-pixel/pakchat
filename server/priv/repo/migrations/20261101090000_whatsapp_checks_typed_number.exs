defmodule Pakchat.Repo.Migrations.WhatsappChecksTypedNumber do
  @moduledoc """
  The sign-in screens now ask for the number first, like WhatsApp. The check
  remembers the number that was typed, so a code sent from another WhatsApp
  number doesn't count (see Pakchat.WhatsApp).
  """
  use Ecto.Migration

  def change do
    alter table(:whatsapp_checks) do
      # The number typed in the app (empty for apps from before build 16).
      add :typed_phone, :string
      # A different number sent the code: the app says so, and waits for the right one.
      add :wrong_phone, :string
    end
  end
end
