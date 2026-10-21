defmodule PakchatWeb.Plugs.Auth do
  @moduledoc """
  Checks the session token on every request under /api (except sign-in).

  The app sends `Authorization: Bearer <token>`. If the token belongs to a
  device, the request carries on with `conn.assigns.device` and
  `conn.assigns.user`. If not, it stops here with 401.
  """
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         %{} = device <- Pakchat.Accounts.device_by_token(token) do
      conn
      |> assign(:device, device)
      |> assign(:user, device.user)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "signed_out"})
        |> halt()
    end
  end
end
