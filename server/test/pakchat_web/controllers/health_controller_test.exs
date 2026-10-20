defmodule PakchatWeb.HealthControllerTest do
  use PakchatWeb.ConnCase

  test "GET /api/health says ok when the database answers", %{conn: conn} do
    conn = get(conn, ~p"/api/health")
    assert json_response(conn, 200) == %{"status" => "ok", "database" => "ok"}
  end
end
