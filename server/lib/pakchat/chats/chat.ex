defmodule Pakchat.Chats.Chat do
  @moduledoc """
  A chat with one person, a group, someone's status, or a community (which
  only holds its members: its groups point to it with `community_id`, and
  its announcements are the group with `announcements`). Holds no messages.
  """
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
    # One-to-one: the person who didn't start the chat has written back.
    field :answered, :boolean, default: false
    field :community_id, :binary_id
    field :announcements, :boolean, default: false
    # A small group made for a call link: joining the link joins its call.
    field :call_link, :boolean, default: false
    field :invite_expires_at, :utc_datetime_usec
    field :invite_max_uses, :integer
    field :invite_uses, :integer, default: 0
    # A community: anyone in it may suggest groups (admins approve them).
    field :groups_by_members, :boolean, default: false
    # A group: its admins approve who joins.
    field :join_approval, :boolean, default: false
    belongs_to :creator, Pakchat.Accounts.User, foreign_key: :created_by
    has_many :members, Pakchat.Chats.Member
    timestamps(type: :utc_datetime_usec)
  end

  def group_changeset(chat, attrs) do
    chat
    |> cast(attrs, [
      :title,
      :description,
      :photo,
      :only_admins_send,
      :groups_by_members,
      :join_approval
    ])
    |> validate_required([:title])
    |> validate_length(:title, min: 1, max: 100)
    |> validate_length(:description, max: 2048)
    |> validate_length(:photo, max: 500)
  end
end
