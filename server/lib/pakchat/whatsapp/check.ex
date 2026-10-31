defmodule Pakchat.WhatsApp.Check do
  @moduledoc "One WhatsApp number check that was started (see Pakchat.WhatsApp)."
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  schema "whatsapp_checks" do
    field :code, :string
    field :secret_hash, :binary, redact: true
    field :purpose, :string
    field :phone, :string
    field :expires_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end
end
