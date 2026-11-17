defmodule Pakchat.Repo.Migrations.PrivacyExcept do
  @moduledoc """
  "My contacts except…", like WhatsApp: last seen, profile photo, About and
  groups can each be shown to my contacts except some people. The people left
  out are kept per setting: %{"last_seen" => [ids], "photo" => [...], ...}.
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :privacy_except, :map, null: false, default: %{}
    end
  end
end
