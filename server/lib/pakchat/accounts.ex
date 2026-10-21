defmodule Pakchat.Accounts do
  @moduledoc """
  People and their devices: signing in, session tokens, profiles, finding
  people by Gmail, and blocking.
  """
  import Ecto.Query
  alias Pakchat.Accounts.{Block, Device, GoogleToken, User}
  alias Pakchat.Repo

  # One phone plus up to 4 linked devices, like WhatsApp.
  @max_linked 4

  ## Signing in

  @doc """
  Signs in with a Google token, from the phone app.

  The phone becomes device 1. Signing in on a new phone takes over the
  account, so the old phone and any linked devices are signed out, exactly
  as WhatsApp does. Returns the session token, which the phone keeps and
  sends with every request. The server only keeps a hash of it.
  """
  def sign_in_with_google(id_token, device_attrs) do
    with {:ok, claims} <- GoogleToken.verify(id_token) do
      sign_in_as(claims, device_attrs)
    end
  end

  @doc """
  Signs in a pretend test account, for the Maestro tests on emulators (which
  have no Google account). Only on a Mac that started the server with
  PAKCHAT_TEST_SIGN_IN=1, never on the live server, and only for made-up
  addresses ending in `@test.pakchat`, so it can never sign in as a real person.
  """
  def sign_in_for_test(email, name, device_attrs) when is_binary(email) and is_binary(name) do
    email = String.downcase(String.trim(email))

    if Application.get_env(:pakchat, :test_sign_in, false) and
         String.ends_with?(email, "@test.pakchat") do
      sign_in_as(%{"sub" => "test:" <> email, "email" => email, "name" => name}, device_attrs)
    else
      {:error, :not_allowed}
    end
  end

  # Both ways of signing in end here: this phone takes over the account and
  # the old devices are told to sign out.
  defp sign_in_as(claims, device_attrs) do
    token = new_token()

    with {:ok, {user, device, old}} <-
           Repo.transaction(fn -> take_over(claims, device_attrs, token) end) do
      Enum.each(old, &disconnect/1)
      {:ok, %{user: user, device: device, token: token}}
    end
  end

  # Finds or makes the account, removes its old devices, and adds this phone.
  defp take_over(claims, device_attrs, token) do
    user = find_or_create_user(claims)
    old = Repo.all(from d in Device, where: d.user_id == ^user.id, select: d.id)
    Repo.delete_all(from d in Device, where: d.user_id == ^user.id)
    attrs = Map.merge(device_attrs, %{user_id: user.id, device_id: 1, token_hash: hash(token)})

    case Repo.insert(Device.register_changeset(%Device{}, attrs)) do
      {:ok, device} -> {user, device, old}
      {:error, changeset} -> Repo.rollback(changeset)
    end
  end

  defp find_or_create_user(%{"sub" => sub} = claims) do
    case Repo.get_by(User, google_sub: sub) do
      %User{} = user ->
        user

      nil ->
        name = claims["name"] || claims["email"] |> String.split("@") |> hd()

        %User{}
        |> User.signup_changeset(%{
          google_sub: sub,
          email: claims["email"],
          name: String.slice(name, 0, 25),
          photo: claims["picture"]
        })
        |> Repo.insert()
        |> case do
          {:ok, user} -> user
          {:error, changeset} -> Repo.rollback(changeset)
        end
    end
  end

  @doc """
  Adds a linked device (a website) to an account. Phase 8 puts the QR code in
  front of this; for now the tests use it to give people several devices.
  """
  def add_linked_device(%User{} = user, device_attrs) do
    taken =
      Repo.all(from d in Device, where: d.user_id == ^user.id, select: d.device_id)

    if length(taken -- [1]) >= @max_linked do
      {:error, :too_many_devices}
    else
      device_id = Enum.find(2..127, &(&1 not in taken))
      token = new_token()

      attrs =
        Map.merge(device_attrs, %{user_id: user.id, device_id: device_id, token_hash: hash(token)})

      with {:ok, device} <- Repo.insert(Device.register_changeset(%Device{}, attrs)) do
        {:ok, %{device: device, token: token}}
      end
    end
  end

  @doc "Finds the device a session token belongs to, with its owner."
  def device_by_token(token) when is_binary(token) do
    Device
    |> where(token_hash: ^hash(token))
    |> preload(:user)
    |> Repo.one()
  end

  def device_by_token(_), do: nil

  @doc """
  Signs a device out. Signing out the phone signs out its linked devices too.
  Anything still waiting for them is deleted with them.
  """
  def sign_out(%Device{device_id: 1, user_id: user_id}) do
    ids = Repo.all(from d in Device, where: d.user_id == ^user_id, select: d.id)
    Repo.delete_all(from d in Device, where: d.user_id == ^user_id)
    Enum.each(ids, &disconnect/1)
    :ok
  end

  def sign_out(%Device{} = device) do
    Repo.delete!(device)
    disconnect(device.id)
    :ok
  end

  def list_devices(user_id) do
    Repo.all(from d in Device, where: d.user_id == ^user_id, order_by: d.device_id)
  end

  def get_device(id), do: Repo.get(Device, id)

  def set_push_token(%Device{} = device, attrs) do
    device |> Device.push_changeset(attrs) |> Repo.update()
  end

  # Closes a device's open connection, if it has one.
  defp disconnect(device_uuid) do
    topic = "device_socket:" <> device_uuid
    message = %Phoenix.Socket.Broadcast{topic: topic, event: "disconnect", payload: %{}}
    Phoenix.PubSub.broadcast(Pakchat.PubSub, topic, message)
  end

  # 32 random bytes, written as text the app can store.
  defp new_token, do: Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)
  defp hash(token), do: :crypto.hash(:sha256, token)

  ## Profiles

  def get_user(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> Repo.get(User, uuid)
      :error -> nil
    end
  end

  def update_profile(%User{} = user, attrs) do
    user |> User.profile_changeset(attrs) |> Repo.update()
  end

  @doc "Finds someone by their Gmail address."
  def find_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: email |> String.trim() |> String.downcase())
  end

  def find_by_email(_), do: nil

  @doc "Remembers when someone was last online."
  def touch_last_seen(user_id) do
    Repo.update_all(from(u in User, where: u.id == ^user_id),
      set: [last_seen_at: DateTime.utc_now()]
    )
  end

  ## Blocking

  def block(%User{id: id}, %User{id: id}), do: {:error, :not_allowed}

  def block(%User{} = me, %User{} = them) do
    Repo.insert(%Block{blocker_id: me.id, blocked_id: them.id}, on_conflict: :nothing)
    :ok
  end

  def unblock(%User{} = me, them_id) do
    Repo.delete_all(from b in Block, where: b.blocker_id == ^me.id and b.blocked_id == ^them_id)
    :ok
  end

  def list_blocked(%User{} = me) do
    Repo.all(
      from u in User,
        join: b in Block,
        on: b.blocked_id == u.id,
        where: b.blocker_id == ^me.id,
        order_by: u.name
    )
  end

  @doc "Has `blocker_id` blocked `blocked_id`?"
  def blocked?(blocker_id, blocked_id) do
    Repo.exists?(
      from b in Block, where: b.blocker_id == ^blocker_id and b.blocked_id == ^blocked_id
    )
  end

  @doc "Has either of the two blocked the other?"
  def blocked_between?(a, b), do: blocked?(a, b) or blocked?(b, a)

  @doc "The ids, out of `user_ids`, of everyone who has blocked `user_id`."
  def blocked_by(user_id, user_ids) do
    Repo.all(
      from b in Block,
        where: b.blocked_id == ^user_id and b.blocker_id in ^user_ids,
        select: b.blocker_id
    )
  end
end
