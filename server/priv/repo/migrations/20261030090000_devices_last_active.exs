defmodule Pakchat.Repo.Migrations.DevicesLastActive do
  @moduledoc """
  When each device was last connected, for Linked devices' "Last active", like WhatsApp's.
  """
  use Ecto.Migration

  def change do
    alter table(:devices) do
      add :last_active_at, :utc_datetime_usec
    end
  end
end
