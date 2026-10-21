defmodule PakchatWeb.Plugs.CORS do
  @moduledoc """
  Lets PakChat's own websites (and only those) talk to the server.

  Browsers block a page from reading answers from another address unless the
  server says it may. Before some requests they first ask with an OPTIONS
  request (a "preflight"), which we answer here. The phone app isn't a
  browser and doesn't need any of this.
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(%Plug.Conn{path_info: ["api" | _]} = conn, _opts) do
    origin = conn |> get_req_header("origin") |> List.first()

    conn =
      if origin && allowed?(origin) do
        conn
        |> put_resp_header("access-control-allow-origin", origin)
        |> put_resp_header("vary", "origin")
        |> put_resp_header("access-control-allow-headers", "authorization, content-type")
        |> put_resp_header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE")
        |> put_resp_header("access-control-max-age", "600")
      else
        conn
      end

    if conn.method == "OPTIONS", do: conn |> send_resp(204, "") |> halt(), else: conn
  end

  def call(conn, _opts), do: conn

  @doc "Is this website one of ours?"
  def allowed?(origin) when is_binary(origin) do
    origin in Application.get_env(:pakchat, :allowed_origins, [])
  end
end
