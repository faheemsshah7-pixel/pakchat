defmodule Pakchat.WhatsApp.Check do
  @moduledoc "One WhatsApp number check that was started (see Pakchat.WhatsApp)."
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  schema "whatsapp_checks" do
    field :code, :string
    field :secret_hash, :binary, redact: true
    field :purpose, :string
    field :phone, :string
    field :typed_phone, :string
    field :wrong_phone, :string
    # The code came from someone whose WhatsApp hides their number: it can't count.
    field :number_hidden, :boolean, default: false
    field :expires_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end
end
