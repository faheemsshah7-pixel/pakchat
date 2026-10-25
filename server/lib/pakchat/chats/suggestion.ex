defmodule Pakchat.Chats.Suggestion do
  @moduledoc """
  A group someone in a community suggested for it, waiting for its admins:
  one of their groups (`group_id`), or a new group by a name (`title`).
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "community_suggestions" do
    field :community_id, :binary_id
    field :group_id, :binary_id
    field :title, :string
    field :suggested_by, :binary_id
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end
end
