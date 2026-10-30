defmodule Pakchat.Accounts.Device do
  @moduledoc """
  One phone or linked website, with its Signal public keys.

  The secret halves of these keys never leave the device. The server only
  keeps what others need to start a locked chat with it.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @key_fields [
    :registration_id,
    :identity_key,
    :signed_pre_key_id,
    :signed_pre_key,
    :signed_pre_key_signature,
    :kyber_last_resort_id,
    :kyber_last_resort_key,
    :kyber_last_resort_signature
  ]

  schema "devices" do
    belongs_to :user, Pakchat.Accounts.User
    field :device_id, :integer
    field :name, :string, default: "Phone"
    field :token_hash, :binary, redact: true
    field :registration_id, :integer
    field :identity_key, :binary
    field :signed_pre_key_id, :integer
    field :signed_pre_key, :binary
    field :signed_pre_key_signature, :binary
    field :kyber_last_resort_id, :integer
    field :kyber_last_resort_key, :binary
    field :kyber_last_resort_signature, :binary
    field :push_token, :string, redact: true
    field :push_platform, :string
    field :last_active_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end

  @doc "A new device. `keys` are already decoded from base64 into bytes."
  def register_changeset(device, attrs) do
    device
    |> cast(attrs, [:user_id, :device_id, :name, :token_hash | @key_fields])
    |> validate_required([:user_id, :device_id, :token_hash | @key_fields])
    |> validate_number(:device_id, greater_than_or_equal_to: 1, less_than_or_equal_to: 127)
    |> validate_length(:name, max: 50)
    |> validate_keys()
    |> unique_constraint([:user_id, :device_id])
  end

  @doc "A fresh signed pre-key or last-resort Kyber key (they are swapped out now and then)."
  def rotate_changeset(device, attrs) do
    device
    |> cast(attrs, @key_fields -- [:registration_id, :identity_key])
    |> validate_keys()
  end

  def push_changeset(device, attrs) do
    device
    |> cast(attrs, [:push_token, :push_platform])
    |> validate_length(:push_token, max: 4096)
    |> validate_inclusion(:push_platform, ~w(fcm apns))
  end

  # Checks that each key is the size Signal's keys are, so nobody can fill
  # the database with junk. (A Curve25519 public key is 33 bytes, a signature
  # is 64, and a Kyber-1024 public key is 1569.)
  defp validate_keys(changeset) do
    changeset
    |> validate_number(:registration_id, greater_than: 0, less_than: 16_384)
    |> validate_byte_size(:identity_key, 33, 33)
    |> validate_byte_size(:signed_pre_key, 33, 33)
    |> validate_byte_size(:signed_pre_key_signature, 64, 64)
    |> validate_byte_size(:kyber_last_resort_key, 1, 1600)
    |> validate_byte_size(:kyber_last_resort_signature, 64, 64)
  end

  @doc false
  def validate_byte_size(changeset, field, min, max) do
    validate_change(changeset, field, fn _, bytes ->
      if byte_size(bytes) in min..max, do: [], else: [{field, "is the wrong size"}]
    end)
  end
end
