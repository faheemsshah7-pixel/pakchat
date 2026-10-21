defmodule Pakchat.Chats.Member do
  @moduledoc "Someone in a chat, and whether they are an admin."
  use Ecto.Schema

  @primary_key false
  @foreign_key_type :binary_id

  schema "chat_members" do
    belongs_to :chat, Pakchat.Chats.Chat, primary_key: true
    belongs_to :user, Pakchat.Accounts.User, primary_key: true
    field :role, :string, default: "member"
    timestamps(type: :utc_datetime_usec)
  end
end
