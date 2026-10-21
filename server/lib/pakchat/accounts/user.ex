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
