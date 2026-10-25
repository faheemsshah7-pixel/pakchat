defmodule PakchatWeb.ReportController do
  @moduledoc "`POST /api/reports`: report a chat or someone in it (see `Pakchat.Reports`)."
  use PakchatWeb, :controller
  alias Pakchat.{RateLimit, Reports}

  action_fallback PakchatWeb.FallbackController

  def create(conn, params) do
    me = conn.assigns.user

    with :ok <- RateLimit.hit(:reports, me.id),
         {:ok, report} <- Reports.create(me, params) do
      conn |> put_status(201) |> json(%{id: report.id})
    end
  end
end
