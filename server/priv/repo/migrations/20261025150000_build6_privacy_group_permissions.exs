defmodule Pakchat.Repo.Migrations.Build6PrivacyGroupPermissions do
  use Ecto.Migration

  # Privacy: who sees my About, and who can add me to groups (like WhatsApp).
  # Groups: whether everyone (not only admins) can edit its info, and add people.
  def change do
    alter table(:users) do
      add :about_visibility, :string, null: false, default: "everyone"
      add :groups_visibility, :string, null: false, default: "everyone"
    end

    alter table(:chats) do
      add :members_edit, :boolean, null: false, default: false
      add :members_add, :boolean, null: false, default: false
    end
  end
end
