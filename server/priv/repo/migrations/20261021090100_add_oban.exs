defmodule Pakchat.Repo.Migrations.AddOban do
  @moduledoc "The tables Oban uses to keep its list of background jobs."
  use Ecto.Migration

  def up, do: Oban.Migration.up()
  def down, do: Oban.Migration.down(version: 1)
end
