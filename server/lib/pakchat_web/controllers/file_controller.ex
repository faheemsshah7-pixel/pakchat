defmodule PakchatWeb.FileController do
  @moduledoc """
  Locked files. Sending one:

    1. `POST /api/files` with `{"chat_id", "size"}` (the locked size, in bytes)
       answers `{"id", "upload_url"}`.
    2. `PUT <upload_url>` with the bytes (`Content-Type: application/octet-stream`).
    3. The file's id and key go inside the message.

  Getting one: `GET /api/files/:id/link` answers `{"url"}`, a link that works
  for a few hours; `GET <url>` gives the bytes. `GET /api/files/limits` says
  how big a file may be, so changing `FILE_MAX_MB` needs no app update.
  """
  use PakchatWeb, :controller
  alias Pakchat.Files

  action_fallback PakchatWeb.FallbackController

  def limits(conn, _params) do
    json(conn, %{max_bytes: Files.max_size(), max_backup_bytes: Files.max_backup()})
  end

  def create(conn, %{"chat_id" => chat_id, "size" => size}) do
    with {:ok, file} <- Files.start_attachment(conn.assigns.user, chat_id, size) do
      json(conn, %{id: file.id, upload_url: Files.link(file, "put").url})
    end
  end

  def create(_conn, _params), do: {:error, :bad_request}

  @doc "`POST /api/photos` with `{size, chat_id?}`: room for my profile photo, or a group's or community's."
  def create_photo(conn, %{"size" => size} = params) do
    with {:ok, file} <- Files.start_photo(conn.assigns.user, params["chat_id"], size) do
      json(conn, %{id: file.id, upload_url: Files.link(file, "put").url})
    end
  end

  def create_photo(_conn, _params), do: {:error, :bad_request}

  def link(conn, %{"id" => id}) do
    with %{} = file <- uploaded(Files.get(id)),
         true <- Files.can_read?(file, conn.assigns.user) || {:error, :not_found} do
      json(conn, Files.link(file, "get"))
    end
  end

  def upload(conn, %{"id" => id} = params) do
    with %{} = file <- Files.from_link(id, "put", params["t"]) do
      # Reads the body about 1 MB at a time.
      read = &read_body(&1, length: 1_000_000, read_length: 1_000_000, read_timeout: 60_000)

      case Files.receive_upload(file, conn, read) do
        {{:ok, _}, conn} -> send_resp(conn, 204, "")
        {error, _conn} -> error
      end
    end
  end

  def download(conn, %{"id" => id} = params) do
    with %{} = file <- uploaded(Files.from_link(id, "get", params["t"])) do
      conn
      |> put_resp_content_type("application/octet-stream")
      |> send_file(200, Files.path(file.id))
    end
  end

  # A file that's still being uploaded looks the same as one that isn't there.
  defp uploaded(%{uploaded: false}), do: {:error, :not_found}
  defp uploaded(other), do: other
end
