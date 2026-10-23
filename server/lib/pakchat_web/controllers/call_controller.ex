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

  # A day: long enough for any call, short enough not to be worth stealing.
  @ttl 24 * 3600

  def ice(conn, _params) do
    json(conn, %{ice_servers: ice_servers(conn.assigns.user.id)})
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
