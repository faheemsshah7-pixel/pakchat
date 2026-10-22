defmodule PakchatWeb.Wire do
  @moduledoc """
  The shapes the app and the website see, as JSON.

  Bytes (keys, locked messages) travel as base64 text. Field names use
  snake_case, like `device_id`.
  """
  alias Pakchat.Accounts.User
  alias Pakchat.Chats.Chat
  alias Pakchat.Relay.Envelope

  @doc "Me, with my own settings."
  def me(%User{} = u) do
    %{
      id: u.id,
      email: u.email,
      phone: u.phone,
      name: u.name,
      about: u.about,
      photo: u.photo,
      privacy: %{
        last_seen: u.last_seen_visibility,
        online: u.online_visibility,
        read_receipts: u.read_receipts
      }
    }
  end

  @doc "Someone else: only what anyone may see."
  def person(%User{} = u), do: %{id: u.id, name: u.name, about: u.about, photo: u.photo}

  @doc "Someone who messaged me first: also how to reach them (see `Chats.reached_out?/2`)."
  def person_with_ways(%User{} = u), do: Map.merge(person(u), %{phone: u.phone, email: u.email})

  def chat(%Chat{} = c, viewer_id) do
    members = Enum.map(c.members, &%{user_id: &1.user_id, role: &1.role})
    admin? = Enum.any?(c.members, &(&1.user_id == viewer_id and &1.role == "admin"))

    %{
      id: c.id,
      kind: c.kind,
      seq: c.seq,
      members: members
    }
    |> Map.merge(
      if c.kind == "group" do
        %{
          title: c.title,
          description: c.description,
          photo: c.photo,
          only_admins_send: c.only_admins_send,
          # Only admins see the invite code, as in today's app.
          invite_code: if(admin?, do: c.invite_code)
        }
      else
        %{}
      end
    )
  end

  @doc """
  One envelope. Locked messages come as `body` (base64). Receipts and group
  notes are plain facts the server already knows, so they come as `data`.
  """
  def envelope(%Envelope{} = e) do
    base = %{
      id: e.id,
      chat_id: e.chat_id,
      seq: e.seq,
      from: e.sender_id,
      from_device: e.sender_device,
      kind: e.kind,
      sent_at: e.sent_at
    }

    if e.kind in ["receipt", "system"] do
      Map.put(base, :data, Jason.decode!(e.body))
    else
      Map.merge(base, %{type: e.type, body: Base.encode64(e.body)})
    end
  end

  @doc "A key bundle for one device (see `Pakchat.Keys`)."
  def bundle(b) do
    Map.new(b, fn
      {k, v} when is_binary(v) -> {k, Base.encode64(v)}
      pair -> pair
    end)
  end

  def errors(%Ecto.Changeset{} = changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
