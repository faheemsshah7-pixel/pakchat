defmodule Pakchat.Chats.Chat do
  @moduledoc "A chat with one person, or a group. Holds no messages."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chats" do
    field :kind, :string
    field :direct_key, :string
    field :title, :string
    field :description, :string
    field :photo, :string
    field :only_admins_send, :boolean, default: false
    field :invite_code, :string
    field :seq, :integer, default: 0
    belongs_to :creator, Pakchat.Accounts.User, foreign_key: :created_by
    has_many :members, Pakchat.Chats.Member
    timestamps(type: :utc_datetime_usec)
  end

  def group_changeset(chat, attrs) do
    chat
    |> cast(attrs, [:title, :description, :photo, :only_admins_send])
    |> validate_required([:title])
    |> validate_length(:title, min: 1, max: 100)
    |> validate_length(:description, max: 2048)
    |> validate_length(:photo, max: 500)
  end
end
