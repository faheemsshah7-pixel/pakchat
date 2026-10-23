defmodule PakchatWeb.GifController do
  @moduledoc """
  GIFs from KLIPY (a free GIF library), passed through the server so PakChat's
  KLIPY key stays here and KLIPY never sees who is searching.

  `GET /api/gifs` answers the popular ones, `GET /api/gifs?q=eid` a search,
  as `{"gifs": [{"id", "mp4", "preview", "width", "height"}], "next"}`.
  Pass `next` back as `pos` for more. Without `KLIPY_KEY` in `server/.env`
  it answers 404, and the app hides its GIF tab.

  Only addresses at static.klipy.com are passed on, so a GIF can never point
  the phone anywhere else. The phone downloads the small video, then sends it
  locked like any other file: the person who gets it never contacts KLIPY.
  """
  use PakchatWeb, :controller
  alias Pakchat.RateLimit

  action_fallback PakchatWeb.FallbackController

  @api "https://api.klipy.com/v2/"

  def index(conn, params) do
    q = params["q"] |> to_string() |> String.trim() |> String.slice(0, 100)
    path = if q == "", do: "featured", else: "search"

    with {:ok, key} <- key(),
         :ok <- RateLimit.hit(:gifs, conn.assigns.user.id),
         {:ok, body} <- ask(path, query(key, q, params)) do
      json(conn, %{gifs: gifs(body["results"]), next: next(body["next"])})
    end
  end

  defp key do
    case Application.get_env(:pakchat, :klipy_key) do
      key when is_binary(key) and key != "" -> {:ok, key}
      _ -> {:error, :not_found}
    end
  end

  # What KLIPY is asked: nothing rude (its "medium" filter), for Pakistan.
  defp query(key, q, params) do
    base = [
      key: key,
      limit: 30,
      media_filter: "tinygif,mp4",
      contentfilter: "medium",
      country: "PK",
      locale: if(params["lang"] == "ur", do: "ur_PK", else: "en_PK")
    ]

    base = if q == "", do: base, else: [{:q, q} | base]
    if is_binary(params["pos"]), do: [{:pos, params["pos"]} | base], else: base
  end

  # Asks KLIPY. The tests swap in a pretend KLIPY.
  defp ask(path, query) do
    req =
      Application.get_env(:pakchat, :klipy_req, fn url, query ->
        Req.get(url, params: query, retry: false, receive_timeout: 8_000)
      end)

    case req.(@api <> path, query) do
      {:ok, %{status: 200, body: %{} = body}} -> {:ok, body}
      _ -> {:error, :unavailable}
    end
  end

  @doc false
  def gifs(results) when is_list(results) do
    for %{} = r <- results,
        mp4 = get_in(r, ["media_formats", "mp4"]),
        tiny = get_in(r, ["media_formats", "tinygif"]),
        is_map(mp4) and is_map(tiny),
        klipy?(mp4["url"]) and klipy?(tiny["url"]) do
      [width, height] = dims(mp4["dims"] || tiny["dims"])

      %{
        id: to_string(r["id"]),
        mp4: mp4["url"],
        preview: tiny["url"],
        width: width,
        height: height
      }
    end
  end

  def gifs(_), do: []

  defp dims([w, h]) when is_integer(w) and is_integer(h) and w > 0 and h > 0, do: [w, h]
  defp dims(_), do: [1, 1]

  defp next(n) when is_binary(n) and n != "" and n != "0", do: n
  defp next(_), do: nil

  defp klipy?(url),
    do:
      is_binary(url) and String.starts_with?(url, "https://static.klipy.com/") and
        byte_size(url) <= 300
end
