defmodule PakchatWeb.CallController do
  @moduledoc """
  What a phone needs to connect a call: `GET /api/calls/ice` answers
  `{"ice_servers": [...]}`, in the shape WebRTC takes.

  Calls go phone to phone. To find a way through home routers, each phone asks
  a STUN server "what's my address from outside?" (free, Google's by default).
  When two phones still can't reach each other (some mobile networks), the call
  goes through a TURN relay: our own coturn, if `TURN_URLS` and `TURN_SECRET`
  are set in `server/.env`. The relay only passes locked call audio and video
  along; it can't listen in.

  The relay password is made fresh for each person and lasts a day, the way
  coturn's `use-auth-secret` expects: the user name is "expiry:user id", the
  password an HMAC-SHA1 of it with the shared secret. So the secret itself
  never leaves the server.
  """
  use PakchatWeb, :controller
  alias Pakchat.{Chats, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  # A day: long enough for any call, short enough not to be worth stealing.
  @ttl 24 * 3600

  def ice(conn, _params) do
    json(conn, %{ice_servers: ice_servers(conn.assigns.user.id)})
  end

  @doc """
  `POST /api/calls/links` with `{title}`: a call link. It's a small group of
  its own; anyone who opens the link joins it (as an invite) and its call.
  """
  def create_link(conn, params) do
    me = conn.assigns.user

    with :ok <- RateLimit.hit(:groups, me.id),
         {:ok, chat} <- Chats.create_call_link(me, %{"title" => params["title"] || "Call"}) do
      conn |> put_status(201) |> json(Wire.chat(chat, me.id))
    end
  end

  @doc """
  `POST /api/calls/room` with `{chat, call}`: a pass into a group call's room on our
  call server (LiveKit, deploy/livekit.yaml), answered `{url, token}`.

  Group calls pass through that server: each phone sends its sound and picture
  there once, and it passes them on to the others, so 32 people fit (phone to
  phone, each would send 31 copies). Everything is locked on the phones first,
  with a key that travels only in the call's own locked messages, so the call
  server can't see or hear anything either.

  Only someone in the chat gets a pass, and only for that chat's calls (the room
  is named after both). It names the phone ("user id:device id"), nothing else:
  no names. Good for two hours of joining; the call server keeps a phone that's
  in the call connected for as long as the call lasts.
  """
  def room(conn, %{"chat" => chat_id, "call" => call_id})
      when is_binary(chat_id) and is_binary(call_id) do
    me = conn.assigns.user
    url = Application.get_env(:pakchat, :livekit_url)
    key = Application.get_env(:pakchat, :livekit_key)
    secret = Application.get_env(:pakchat, :livekit_secret)

    with :ok <-
           if(Enum.all?([url, key, secret], &(is_binary(&1) and &1 != "")),
             do: :ok,
             else: {:error, :not_found}
           ),
         :ok <-
           if(String.match?(call_id, ~r/^[A-Za-z0-9_-]{1,64}$/),
             do: :ok,
             else: {:error, :bad_request}
           ),
         :ok <- RateLimit.hit(:calls, me.id),
         {:ok, chat} <- Chats.get_chat(me, chat_id),
         :ok <- if(chat.kind == "status", do: {:error, :not_found}, else: :ok) do
      identity = "#{me.id}:#{conn.assigns.device.device_id}"
      json(conn, %{url: url, token: room_token(key, secret, identity, "#{chat.id}:#{call_id}")})
    end
  end

  def room(_conn, _params), do: {:error, :bad_request}

  @doc false
  def room_token(key, secret, identity, room) do
    now = System.system_time(:second)

    claims = %{
      iss: key,
      sub: identity,
      nbf: now - 10,
      exp: now + 2 * 3600,
      video: %{
        room: room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false
      }
    }

    part = &Base.url_encode64(Jason.encode!(&1), padding: false)
    body = part.(%{alg: "HS256", typ: "JWT"}) <> "." <> part.(claims)
    body <> "." <> Base.url_encode64(:crypto.mac(:hmac, :sha256, secret, body), padding: false)
  end

  @doc false
  def ice_servers(user_id) do
    stun = Application.get_env(:pakchat, :stun_urls, ["stun:stun.l.google.com:19302"])
    turn = Application.get_env(:pakchat, :turn_urls, [])
    secret = Application.get_env(:pakchat, :turn_secret)

    relay =
      if turn != [] and is_binary(secret) and secret != "" do
        username = "#{System.system_time(:second) + @ttl}:#{user_id}"
        password = :crypto.mac(:hmac, :sha, secret, username) |> Base.encode64()
        [%{urls: turn, username: username, credential: password}]
      else
        []
      end

    if(stun == [], do: [], else: [%{urls: stun}]) ++ relay
  end
end
