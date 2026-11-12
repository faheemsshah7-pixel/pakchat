defmodule Pakchat.Repo.Migrations.WhatsappChecksNumberHidden do
  @moduledoc """
  Someone with a WhatsApp username can hide their number from businesses. Their
  code then comes without a number, and can't count. The check remembers that,
  so the app can say why and offer Google instead (see Pakchat.WhatsApp).
  """
  use Ecto.Migration

  def change do
    alter table(:whatsapp_checks) do
      add :number_hidden, :boolean, null: false, default: false
    end
  end
end
