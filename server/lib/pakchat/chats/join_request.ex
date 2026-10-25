defmodule Pakchat.Chats.JoinRequest do
  @moduledoc "Someone asking to join a group whose admins approve who joins."
  use Ecto.Schema

  @primary_key false
  @foreign_key_type :binary_id

  schema "join_requests" do
    field :chat_id, :binary_id, primary_key: true
    field :user_id, :binary_id, primary_key: true
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end
end
