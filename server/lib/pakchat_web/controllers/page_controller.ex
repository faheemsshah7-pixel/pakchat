defmodule PakchatWeb.PageController do
  use PakchatWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end

  @doc "An invite link opened in a browser: a button that opens it in PakChat."
  def join(conn, %{"code" => code}), do: open_in_app(conn, "join/" <> code, "Join on PakChat")

  def call_link(conn, %{"code" => code}),
    do: open_in_app(conn, "calllink/" <> code, "Join the call on PakChat")

  defp open_in_app(conn, path, title) do
    link = "pakchat://" <> URI.encode(path, &(URI.char_unreserved?(&1) or &1 == ?/))
    safe_title = Phoenix.HTML.html_escape(title) |> Phoenix.HTML.safe_to_string()

    page = """
    <!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>#{safe_title}</title>
    <style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    a{display:inline-block;padding:14px 26px;border-radius:16px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}
    p{color:#9aa0aa}</style></head>
    <body><div style="text-align:center;padding:16px"><h2>#{safe_title}</h2>
    <p>Opens in the PakChat app.</p><a href="#{link}">Open PakChat</a></div></body></html>
    """

    conn |> put_resp_content_type("text/html") |> send_resp(200, page)
  end
end
