defmodule Pakchat.Repo.Migrations.ProfilePhotos do
  @moduledoc """
  Photos for people, groups and communities, like WhatsApp's: who may see
  my profile photo (everyone, my contacts, or nobody). The photos are files
  of kind "photo" (see `Pakchat.Files`).
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :photo_visibility, :string, default: "everyone", null: false
    end
  end
end
