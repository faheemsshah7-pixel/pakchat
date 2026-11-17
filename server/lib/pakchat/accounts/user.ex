defmodule Pakchat.Accounts.User do
  @moduledoc "A person on PakChat: their profile and privacy settings."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  # "contacts" means people you have a one-to-one chat with, as in today's app.
  # "except" means my contacts except the people in `privacy_except` for that setting.
  @last_seen_choices ~w(everyone contacts except nobody)
  # "same" means: the same people who can see your last seen.
  @online_choices ~w(everyone same)
  # Who sees my profile photo, and my About.
  @photo_choices ~w(everyone contacts except nobody)
  # Who can add me to groups (WhatsApp's Privacy › Groups).
  @groups_choices ~w(everyone contacts except)

  @doc "The settings that can leave people out (\"My contacts except…\")."
  def except_keys, do: ~w(last_seen photo about groups)
  # At most this many people left out of one setting.
  @max_except 2_000

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
    field :photo_visibility, :string, default: "everyone"
    field :about_visibility, :string, default: "everyone"
    field :groups_visibility, :string, default: "everyone"
    field :read_receipts, :boolean, default: true
    # "My contacts except…": per setting (see except_keys/0), the user ids left out.
    field :privacy_except, :map, default: %{}
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
      :photo_visibility,
      :about_visibility,
      :groups_visibility,
      :read_receipts,
      :privacy_except
    ])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 25)
    |> validate_length(:about, max: 139)
    |> validate_length(:photo, max: 500)
    |> validate_inclusion(:last_seen_visibility, @last_seen_choices)
    |> validate_inclusion(:online_visibility, @online_choices)
    |> validate_inclusion(:photo_visibility, @photo_choices)
    |> validate_inclusion(:about_visibility, @photo_choices)
    |> validate_inclusion(:groups_visibility, @groups_choices)
    |> validate_change(:privacy_except, &check_except/2)
    |> tidy_except()
  end

  # Good lists are kept in one form: each id lower case, once (the checks compare exactly).
  defp tidy_except(changeset) do
    case get_change(changeset, :privacy_except) do
      except when is_map(except) ->
        if Keyword.has_key?(changeset.errors, :privacy_except) do
          changeset
        else
          put_change(
            changeset,
            :privacy_except,
            Map.new(except, fn {k, ids} -> {k, ids |> Enum.map(&uuid!/1) |> Enum.uniq()} end)
          )
        end

      _ ->
        changeset
    end
  end

  defp uuid!(id) do
    {:ok, uuid} = Ecto.UUID.cast(id)
    uuid
  end

  # Only the known settings, each a list of user ids (no more than @max_except).
  defp check_except(field, value) do
    ok =
      is_map(value) and
        Enum.all?(value, fn {k, ids} ->
          k in except_keys() and is_list(ids) and length(ids) <= @max_except and
            Enum.all?(ids, &match?({:ok, _}, Ecto.UUID.cast(&1)))
        end)

    if ok, do: [], else: [{field, "is invalid"}]
  end
end
