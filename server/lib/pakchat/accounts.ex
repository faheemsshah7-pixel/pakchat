defmodule Pakchat.Accounts do
  @moduledoc """
  People and their devices: signing in, session tokens, profiles, finding
  people by Gmail, and blocking.
  """
  import Ecto.Query
  alias Pakchat.Accounts.{Block, Device, GoogleToken, User}
  alias Pakchat.{Phone, PhoneCodes, Repo}

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
  Sends a sign-in code by SMS (or prints it in the Terminal, see `Pakchat.Sms`).
  `phone` is as typed; the reply has the tidied number.
  """
  def send_sign_in_code(phone) do
    with {:ok, phone} <- Phone.normalize(phone),
         {:ok, info} <- PhoneCodes.send_code(phone, "sign_in") do
      {:ok, Map.put(info, :phone, phone)}
    end
  end

  @doc """
  Signs in with a phone number and the code we sent it. Makes the account the
  first time; the reply's `new_account` tells the app to ask for a name.
  """
  def sign_in_with_phone(phone, code, device_attrs) do
    with {:ok, phone} <- Phone.normalize(phone),
         :ok <- PhoneCodes.check(phone, "sign_in", code) do
      sign_in_as(%{"phone" => phone}, device_attrs)
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

    with {:ok, {user, device, old, new?}} <-
           Repo.transaction(fn -> take_over(claims, device_attrs, token) end) do
      Enum.each(old, &disconnect/1)
      {:ok, %{user: user, device: device, token: token, new_account: new?}}
    end
  end

  # Finds or makes the account, removes its old devices, and adds this phone.
  defp take_over(claims, device_attrs, token) do
    {user, new?} = find_or_create_user(claims)
    old = Repo.all(from d in Device, where: d.user_id == ^user.id, select: d.id)
    Repo.delete_all(from d in Device, where: d.user_id == ^user.id)
    attrs = Map.merge(device_attrs, %{user_id: user.id, device_id: 1, token_hash: hash(token)})

    case Repo.insert(Device.register_changeset(%Device{}, attrs)) do
      {:ok, device} -> {user, device, old, new?}
      {:error, changeset} -> Repo.rollback(changeset)
    end
  end

  defp find_or_create_user(%{"phone" => phone}) do
    case Repo.get_by(User, phone: phone) do
      %User{} = user ->
        {user, false}

      nil ->
        # Until they pick a name: "PakChat 4567", from the end of the number.
        %User{}
        |> User.phone_signup_changeset(%{
          phone: phone,
          name: "PakChat " <> String.slice(phone, -4, 4)
        })
        |> insert_new()
    end
  end

  defp find_or_create_user(%{"sub" => sub} = claims) do
    case Repo.get_by(User, google_sub: sub) do
      %User{} = user ->
        {user, false}

      nil ->
        name = claims["name"] || claims["email"] |> String.split("@") |> hd()

        %User{}
        |> User.signup_changeset(%{
          google_sub: sub,
          email: claims["email"],
          # No photo from the Google account (owner, 1 Nov): like signing in by number,
          # everyone shows their first letter until they pick their own photo.
          name: String.slice(name, 0, 25)
        })
        |> insert_new()
    end
  end

  defp insert_new(changeset) do
    case Repo.insert(changeset) do
      {:ok, user} -> {user, true}
      {:error, changeset} -> Repo.rollback(changeset)
    end
  end

  ## One account, two ways in: Gmail and phone number

  @doc """
  Adds a Gmail to my account (I signed in by phone). Google's token proves
  it's mine. If that Gmail already has its own PakChat account, it's refused
  (`:taken`) unless `move: true`: then it moves here (owner, 31 Oct, "Move it
  here"), and that other account is deleted if the Gmail was its only way in.
  """
  def link_google(%User{} = user, id_token, opts \\ []) do
    move? = Keyword.get(opts, :move, false)

    with {:ok, claims} <- GoogleToken.verify(id_token),
         email = String.downcase(claims["email"] || ""),
         :ok <- free_or_move(:google_sub, claims["sub"], user, move?, :google),
         :ok <- free_or_move(:email, email, user, move?, :google) do
      user
      |> User.link_google_changeset(%{google_sub: claims["sub"], email: claims["email"]})
      |> Repo.update()
    end
  end

  @doc "Sends a code to a number I want to add to my account (`move: true`: even if it has its own account)."
  def send_link_code(%User{} = user, phone, opts \\ []) do
    move? = Keyword.get(opts, :move, false)

    with {:ok, phone} <- Phone.normalize(phone),
         :ok <- if(move?, do: :ok, else: free(User, :phone, phone, user)),
         {:ok, info} <- PhoneCodes.send_code(phone, "link") do
      {:ok, Map.put(info, :phone, phone)}
    end
  end

  @doc """
  Adds the number to my account, once the code proves it's mine. With
  `move: true` a number that has its own account moves here, as for a Gmail;
  nothing is moved until the code checks out.
  """
  def link_phone(%User{} = user, phone, code, opts \\ []) do
    move? = Keyword.get(opts, :move, false)

    with {:ok, phone} <- Phone.normalize(phone),
         :ok <- if(move?, do: :ok, else: free(User, :phone, phone, user)),
         :ok <- PhoneCodes.check(phone, "link", code),
         :ok <- free_or_move(:phone, phone, user, move?, :phone) do
      user |> User.link_phone_changeset(%{phone: phone}) |> Repo.update()
    end
  end

  # The Gmail or number is free, or mine already: fine. Someone else's account:
  # refused, or (moving) taken off that account, which is deleted if it was its only way in.
  defp free_or_move(_field, value, _me, _move?, _what) when value in [nil, ""], do: :ok

  defp free_or_move(field, value, %User{id: my_id}, move?, what) do
    case Repo.get_by(User, [{field, value}]) do
      nil -> :ok
      %User{id: ^my_id} -> :ok
      %User{} when not move? -> {:error, :taken}
      %User{} = other -> release(other, what)
    end
  end

  defp release(%User{phone: phone} = other, :google) when is_binary(phone) do
    with {:ok, _} <- unlink(other, :google), do: :ok
  end

  defp release(%User{google_sub: sub} = other, :phone) when is_binary(sub) do
    with {:ok, _} <- unlink(other, :phone), do: :ok
  end

  defp release(%User{} = other, _what), do: delete_account(other)

  @doc """
  Deletes an account for good, like WhatsApp's Delete account: it leaves its
  communities and groups first (so the others see "left" and a group always
  keeps an admin), then its files (except a group photo it set, and files it
  already sent, which stay with the others: see Pakchat.Files.delete_owned/1),
  its status, devices (signed out at once), blocks and everything else of it
  go with it.
  """
  def delete_account(%User{id: id} = user) do
    for kind <- ["community", "group"], chat_id <- my_chats(id, kind) do
      # Leaving a community already took it out of that community's groups.
      _ = Pakchat.Chats.remove_member(user, chat_id, id)
    end

    Pakchat.Files.delete_owned(user)
    Pakchat.Chats.delete_status(id)
    devices = Repo.all(from d in Device, where: d.user_id == ^id, select: d.id)
    Repo.delete_all(from u in User, where: u.id == ^id)
    Enum.each(devices, &disconnect/1)
    :ok
  end

  @doc """
  Settings › Account › Delete my account, from my phone. Like WhatsApp, I type my
  number (or, with no number, my Gmail) first, so a wrong tap can't delete anything.
  Answers `{:error, :wrong_confirm}` when what I typed isn't mine.
  """
  def delete_my_account(%User{} = user, typed) when is_binary(typed) do
    if confirms?(user, typed), do: delete_account(user), else: {:error, :wrong_confirm}
  end

  def delete_my_account(_user, _typed), do: {:error, :wrong_confirm}

  defp confirms?(%User{phone: phone}, typed) when is_binary(phone),
    do: Phone.normalize(typed) == {:ok, phone}

  defp confirms?(%User{email: email}, typed) when is_binary(email),
    do: String.downcase(String.trim(typed)) == String.downcase(email)

  defp confirms?(_user, _typed), do: false

  @doc """
  The Delete account web page (`/delete-account`, which Google Play asks for): WhatsApp
  proved the number (Pakchat.WhatsApp, purpose "delete"), and its one-time code deletes
  the account on it. `{:error, :no_account}` when no PakChat account has that number.
  """
  def delete_by_phone(phone, code) when is_binary(phone) and is_binary(code) do
    with {:ok, phone} <- Phone.normalize(phone),
         :ok <- PhoneCodes.check(phone, "delete", code) do
      case Repo.get_by(User, phone: phone) do
        nil -> {:error, :no_account}
        %User{} = user -> delete_account(user)
      end
    end
  end

  def delete_by_phone(_phone, _code), do: {:error, :bad_request}

  defp my_chats(user_id, kind) do
    Repo.all(
      from c in Pakchat.Chats.Chat,
        join: m in Pakchat.Chats.Member,
        on: m.chat_id == c.id and m.user_id == ^user_id,
        where: c.kind == ^kind and not c.announcements,
        select: c.id
    )
  end

  @doc "Takes the Gmail or the number off my account, as long as the other stays."
  def unlink(%User{phone: nil}, :google), do: {:error, :last_sign_in}
  def unlink(%User{google_sub: nil}, :phone), do: {:error, :last_sign_in}

  def unlink(%User{} = user, :google),
    do: user |> User.link_google_changeset(%{google_sub: nil, email: nil}) |> Repo.update()

  def unlink(%User{} = user, :phone),
    do: user |> User.link_phone_changeset(%{phone: nil}) |> Repo.update()

  # The Gmail or number isn't someone else's account already.
  defp free(schema, field, value, %User{id: my_id}) do
    case Repo.get_by(schema, [{field, value}]) do
      nil -> :ok
      %{id: ^my_id} -> :ok
      _ -> {:error, :taken}
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

  @doc "Finds someone by their phone number, typed any way."
  def find_by_phone(phone) do
    case Phone.normalize(phone) do
      {:ok, phone} -> Repo.get_by(User, phone: phone)
      _ -> nil
    end
  end

  @doc """
  Which of these hashed numbers and Gmails are on PakChat (for "contacts on
  PakChat"). Returns `[{hash, user}]`. The phone hashes its contacts itself,
  so the numbers in its address book are never sent as they are.
  """
  def match_hashes(phone_hashes, email_hashes) do
    phones =
      Repo.all(from u in User, where: u.phone_hash in ^phone_hashes, select: {u.phone_hash, u})

    emails =
      Repo.all(from u in User, where: u.email_hash in ^email_hashes, select: {u.email_hash, u})

    phones ++ emails
  end

  @doc "Remembers when someone was last online."
  def touch_last_seen(user_id) do
    Repo.update_all(from(u in User, where: u.id == ^user_id),
      set: [last_seen_at: DateTime.utc_now()]
    )
  end

  @doc "Remembers when a device was last connected (Linked devices' \"Last active\")."
  def touch_device(device_uuid) do
    Repo.update_all(from(d in Device, where: d.id == ^device_uuid),
      set: [last_active_at: DateTime.utc_now()]
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
  def blocked_between?(a, b) do
    Repo.exists?(
      from x in Block,
        where:
          (x.blocker_id == ^a and x.blocked_id == ^b) or
            (x.blocker_id == ^b and x.blocked_id == ^a)
    )
  end

  @doc "The ids, out of `user_ids`, of everyone who has blocked `user_id`."
  def blocked_by(user_id, user_ids) do
    Repo.all(
      from b in Block,
        where: b.blocked_id == ^user_id and b.blocker_id in ^user_ids,
        select: b.blocker_id
    )
  end
end
