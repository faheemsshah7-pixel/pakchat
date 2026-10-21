defmodule Pakchat.Accounts.PreKey do
  @moduledoc """
  A one-time pre-key. Someone starting a chat with this device takes one, and
  the server deletes it, so no two people ever use the same one.
  """
  use Ecto.Schema
  import Ecto.Changeset
  alias Pakchat.Accounts.Device

  @foreign_key_type :binary_id

  schema "pre_keys" do
    belongs_to :device, Device
    field :kind, :string
    field :key_id, :integer
    field :public_key, :binary
    field :signature, :binary
  end

  def changeset(pre_key, attrs) do
    pre_key
    |> cast(attrs, [:device_id, :kind, :key_id, :public_key, :signature])
    |> validate_required([:device_id, :kind, :key_id, :public_key])
    |> validate_inclusion(:kind, ~w(ec kyber))
    |> validate_number(:key_id, greater_than_or_equal_to: 0, less_than: 16_777_216)
    |> validate_by_kind()
  end

  # Classic keys are 33 bytes with no signature. Kyber keys are bigger and signed.
  defp validate_by_kind(changeset) do
    case get_field(changeset, :kind) do
      "ec" ->
        Device.validate_byte_size(changeset, :public_key, 33, 33)

      "kyber" ->
        changeset
        |> validate_required([:signature])
        |> Device.validate_byte_size(:public_key, 1, 1600)
        |> Device.validate_byte_size(:signature, 64, 64)

      _ ->
        changeset
    end
  end
end
