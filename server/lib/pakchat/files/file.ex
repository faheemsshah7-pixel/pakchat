defmodule Pakchat.Files.File do
  @moduledoc "One locked file (or backup) the server is holding. Never its key."
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "files" do
    field :owner_id, :binary_id
    field :chat_id, :binary_id

    # "attachment", "backup", or "photo" (a person's, group's or community's picture, kept until it's replaced).
    field :kind, :string, default: "attachment"
    field :size, :integer
    field :uploaded, :boolean, default: false
    field :expires_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end
end
