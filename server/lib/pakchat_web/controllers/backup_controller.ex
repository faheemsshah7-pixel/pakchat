defmodule PakchatWeb.BackupController do
  @moduledoc """
  My one encrypted backup. The phone locks it with a key made from my backup
  password before uploading; the server never sees the password or the key.

    * `GET /api/backup`: `{"id", "size", "made_at", "url"}`, or 404 if there's none.
    * `POST /api/backup` with `{"size"}`: `{"id", "upload_url"}`. Once that upload
      finishes, the older backup is deleted.
    * `DELETE /api/backup`: deletes it.
  """
  use PakchatWeb, :controller
  alias Pakchat.Files

  action_fallback PakchatWeb.FallbackController

  def show(conn, _params) do
    with %{} = file <- Files.latest_backup(conn.assigns.user) do
      json(conn, %{
        id: file.id,
        size: file.size,
        made_at: file.updated_at,
        url: Files.link(file, "get").url
      })
    end
  end

  def create(conn, %{"size" => size}) do
    with {:ok, file} <- Files.start_backup(conn.assigns.user, size) do
      json(conn, %{id: file.id, upload_url: Files.link(file, "put").url})
    end
  end

  def create(_conn, _params), do: {:error, :bad_request}

  def delete(conn, _params) do
    Files.delete_backups(conn.assigns.user)
    send_resp(conn, 204, "")
  end
end
