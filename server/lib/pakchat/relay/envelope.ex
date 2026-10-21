defmodule Pakchat.Relay.Envelope do
  @moduledoc """
  One locked message waiting for one device.

  The server can see who it is from, which chat, the chat's counter number,
  and when. `body` is locked bytes it cannot open (or, for receipts and
  system notes, a few plain facts the server already knows).
  """
  use Ecto.Schema

  @foreign_key_type :binary_id

  schema "pending_envelopes" do
    field :device_id, :binary_id
    field :chat_id, :binary_id
    field :seq, :integer
    field :sender_id, :binary_id
    field :sender_device, :integer
    field :kind, :string
    field :type, :integer
    field :body, :binary
    field :sent_at, :utc_datetime_usec
    field :expires_at, :utc_datetime_usec
  end
end
