defmodule Pakchat.Reports do
  @moduledoc """
  Reports of a chat or a person. The server can't read anyone's messages, so
  a report carries only the last few messages the reporter's own phone chose
  to send with it (as on WhatsApp), kept for whoever runs PakChat to look at.
  """
  use Ecto.Schema
  import Ecto.Changeset
  alias Pakchat.Accounts.User
  alias Pakchat.{Chats, Repo}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @reasons ~w(spam abuse scam other)
  @max_messages 5

  schema "reports" do
    field :reporter_id, :binary_id
    field :chat_id, :binary_id
    field :user_id, :binary_id
    field :reason, :string
    field :messages, :map
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  @doc """
  Saves a report about a chat I'm in, or a person in it. `messages` is a list of
  `%{author, text, at}`, at most 5, each text at most 2000 characters.
  """
  def create(%User{} = me, params) do
    with {:ok, chat} <- Chats.get_chat(me, params["chat_id"]),
         {:ok, user_id} <- reported_user(chat, params["user_id"]),
         {:ok, messages} <- messages(params["messages"]) do
      %__MODULE__{reporter_id: me.id, chat_id: chat.id, user_id: user_id}
      |> cast(%{reason: params["reason"] || "other", messages: %{"list" => messages}}, [
        :reason,
        :messages
      ])
      |> validate_inclusion(:reason, @reasons)
      |> Repo.insert()
    end
  end

  defp reported_user(_chat, nil), do: {:ok, nil}

  defp reported_user(chat, id) do
    if Enum.any?(chat.members, &(&1.user_id == id)), do: {:ok, id}, else: {:error, :not_found}
  end

  defp messages(nil), do: {:ok, []}

  defp messages(list) when is_list(list) and length(list) <= @max_messages do
    if Enum.all?(list, &good_message?/1),
      do: {:ok, Enum.map(list, &Map.take(&1, ["author", "text", "at"]))},
      else: {:error, :bad_request}
  end

  defp messages(_), do: {:error, :bad_request}

  defp good_message?(%{"author" => a, "text" => t} = m) when is_binary(a) and is_binary(t),
    do:
      byte_size(a) <= 64 and String.length(t) <= 2000 and (m["at"] == nil or is_integer(m["at"]))

  defp good_message?(_), do: false
end
