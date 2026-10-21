defmodule PakchatWeb.HealthControllerTest do
  use PakchatWeb.ConnCase

  test "GET /api/health says ok when the database answers", %{conn: conn} do
    conn = get(conn, ~p"/api/health")
    assert json_response(conn, 200) == %{"status" => "ok", "database" => "ok"}
  end

  test "GET /api/health can be read from PakChat's own websites only", %{conn: conn} do
    ours = conn |> put_req_header("origin", "http://localhost:5173") |> get(~p"/api/health")
    assert get_resp_header(ours, "access-control-allow-origin") == ["http://localhost:5173"]

    theirs =
      build_conn() |> put_req_header("origin", "https://evil.example") |> get(~p"/api/health")

    assert get_resp_header(theirs, "access-control-allow-origin") == []
  end
end
