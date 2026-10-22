defmodule PakchatWeb.UserController do
  @moduledoc "Finding people, their profiles, and whether they're online."
  use PakchatWeb, :controller
  alias Pakchat.{Accounts, Chats, Privacy, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  @doc """
  `GET /api/users/lookup?email=sara@gmail.com` or `?phone=03001234567`.
  Limited, so nobody can try thousands.
  """
  def lookup(conn, params) do
    with :ok <- RateLimit.hit(:lookup, conn.assigns.user.id),
         %{} = user <- find(params) do
      json(conn, Wire.person(user))
    end
  end

  defp find(%{"phone" => phone}) when is_binary(phone), do: Accounts.find_by_phone(phone)
  defp find(params), do: Accounts.find_by_email(params["email"])

  @doc """
  `POST /api/contacts/match` with `{"phones": [hash, ...], "emails": [hash, ...]}`:
  which of my phone's contacts are on PakChat. Each hash is the base64 SHA-256
  of a tidied number (or a lowercased Gmail), made on the phone. Answers
  `[{"hash": ..., "user": {...}}]`. At most 2000 hashes a time, and a few times an hour.
  """
  def match(conn, params) do
    phones = hashes(params["phones"])
    emails = hashes(params["emails"])

    with :ok <- RateLimit.hit(:contacts, conn.assigns.user.id),
         true <- length(phones) + length(emails) <= 2000 || {:error, :too_many} do
      found =
        for {hash, user} <- Accounts.match_hashes(phones, emails),
            user.id != conn.assigns.user.id,
            do: %{hash: Base.encode64(hash), user: Wire.person(user)}

      json(conn, found)
    end
  end

  defp hashes(list) when is_list(list) do
    for h <- list,
        is_binary(h),
        {:ok, bytes} <- [Base.decode64(h)],
        byte_size(bytes) == 32,
        do: bytes
  end

  defp hashes(_), do: []

  @doc """
  `GET /api/users/:id`: someone's name, about and photo. If they started a chat
  with me, also their `phone` and `email`, so I can add them to my contacts.
  """
  def show(conn, %{"id" => id}) do
    with %{} = user <- Accounts.get_user(id) do
      if Chats.reached_out?(user.id, conn.assigns.user.id),
        do: json(conn, Wire.person_with_ways(user)),
        else: json(conn, Wire.person(user))
    end
  end

  @doc "Online and last seen, as far as their privacy settings let me see."
  def presence(conn, %{"id" => id}) do
    with %{} = user <- Accounts.get_user(id) do
      json(conn, Privacy.presence_for(conn.assigns.user, user))
    end
  end
end
