defmodule Pakchat.PhoneCodes.Code do
  @moduledoc "One sign-in code that was sent (only its hash)."
  use Ecto.Schema

  schema "phone_codes" do
    field :phone, :string
    field :purpose, :string
    field :code_hash, :binary, redact: true
    field :tries, :integer, default: 0
    field :expires_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end
end
