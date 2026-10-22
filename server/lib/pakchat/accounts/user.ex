defmodule Pakchat.Accounts.User do
  @moduledoc "A person on PakChat: their profile and privacy settings."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  # "contacts" means people you have a one-to-one chat with, as in today's app.
  @last_seen_choices ~w(everyone contacts nobody)
  # "same" means: the same people who can see your last seen.
  @online_choices ~w(everyone same)

  schema "users" do
    field :google_sub, :string
    field :email, :string
    field :phone, :string
    field :phone_hash, :binary
    field :email_hash, :binary
    field :name, :string
    field :about, :string, default: "Hey there! I am using PakChat."
    field :photo, :string
    field :last_seen_visibility, :string, default: "everyone"
    field :online_visibility, :string, default: "everyone"
    field :read_receipts, :boolean, default: true
    field :last_seen_at, :utc_datetime_usec

    has_many :devices, Pakchat.Accounts.Device
    timestamps(type: :utc_datetime_usec)
  end

  @doc "Used when someone signs in with Google for the first time."
  def signup_changeset(user, attrs) do
    user
    |> cast(attrs, [:google_sub, :email, :name, :photo])
    |> validate_required([:google_sub, :email, :name])
    |> update_change(:email, &String.downcase/1)
    |> validate_length(:name, max: 25)
    |> unique_constraint(:google_sub)
    |> unique_constraint(:email)
    |> put_hashes()
  end

  @doc "Used when someone signs in with a phone number for the first time."
  def phone_signup_changeset(user, attrs) do
    user
    |> cast(attrs, [:phone, :name])
    |> validate_required([:phone, :name])
    |> unique_constraint(:phone)
    |> put_hashes()
  end

  @doc "Adds (or, with nils, removes) the Gmail on an account."
  def link_google_changeset(user, attrs) do
    user
    |> cast(attrs, [:google_sub, :email])
    |> update_change(:email, &(&1 && String.downcase(&1)))
    |> unique_constraint(:google_sub)
    |> unique_constraint(:email)
    |> put_hashes()
  end

  @doc "Adds (or, with nil, removes) the phone number on an account."
  def link_phone_changeset(user, attrs) do
    user
    |> cast(attrs, [:phone])
    |> unique_constraint(:phone)
    |> put_hashes()
  end

  # Keeps the hashes used by "contacts on PakChat" in step with the number and Gmail.
  defp put_hashes(changeset) do
    phone = get_field(changeset, :phone)
    email = get_field(changeset, :email)

    changeset
    |> put_change(:phone_hash, phone && Pakchat.Phone.hash(phone))
    |> put_change(:email_hash, email && Pakchat.Phone.email_hash(email))
  end

  @doc "What the person can change about themselves."
  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [
      :name,
      :about,
      :photo,
      :last_seen_visibility,
      :online_visibility,
      :read_receipts
    ])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 25)
    |> validate_length(:about, max: 139)
    |> validate_length(:photo, max: 500)
    |> validate_inclusion(:last_seen_visibility, @last_seen_choices)
    |> validate_inclusion(:online_visibility, @online_choices)
  end
end
