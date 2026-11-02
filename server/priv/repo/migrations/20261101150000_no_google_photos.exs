defmodule Pakchat.Repo.Migrations.NoGooglePhotos do
  @moduledoc """
  Signing in with Gmail no longer takes the Google account's picture (owner, 1 Nov):
  like signing in by number, everyone shows their first letter until they pick their
  own photo. The Google pictures already saved (web addresses; a photo picked in
  PakChat is a `pk1:` value) are cleared.
  """
  use Ecto.Migration

  def up do
    execute "UPDATE users SET photo = NULL WHERE photo LIKE 'https://%'"
  end

  def down, do: :ok
end
