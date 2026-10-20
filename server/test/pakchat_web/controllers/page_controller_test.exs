defmodule PakchatWeb.PageControllerTest do
  use PakchatWeb.ConnCase

  test "GET / shows the server is up", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert html_response(conn, 200) =~ "Server running"
  end
end
