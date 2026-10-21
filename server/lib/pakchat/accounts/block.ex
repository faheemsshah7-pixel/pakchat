defmodule Pakchat.Accounts.Block do
  @moduledoc "One person blocking another."
  use Ecto.Schema

  @primary_key false
  @foreign_key_type :binary_id

  schema "blocks" do
    belongs_to :blocker, Pakchat.Accounts.User, primary_key: true
    belongs_to :blocked, Pakchat.Accounts.User, primary_key: true
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end
end
