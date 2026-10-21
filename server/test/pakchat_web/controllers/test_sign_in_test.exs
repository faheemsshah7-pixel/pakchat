defmodule PakchatWeb.TestSignInTest do
  # Not async: it switches test sign-in on and off for the whole server.
  use PakchatWeb.ConnCase, async: false
  import Pakchat.Fixtures

  defp test_sign_in(conn, email, name \\ "Ali") do
    post(conn, ~p"/api/auth/test", %{
      "email" => email,
      "name" => name,
      "device" => device_params(),
      "pre_keys" => pre_keys(1, 5),
      "kyber_pre_keys" => kyber_pre_keys(1, 5)
    })
  end

  defp switch(on) do
    Application.put_env(:pakchat, :test_sign_in, on)
    on_exit(fn -> Application.delete_env(:pakchat, :test_sign_in) end)
  end

  test "is off unless the server was started with it on", %{conn: conn} do
    switch(false)
    assert conn |> get(~p"/api/auth/test") |> json_response(404)
    assert conn |> test_sign_in("ali@test.pakchat") |> json_response(404)
  end

  test "when on, makes a pretend account that works like a real one", %{conn: conn} do
    switch(true)
    assert %{"on" => true} = conn |> get(~p"/api/auth/test") |> json_response(200)

    body = conn |> test_sign_in("Ali@Test.Pakchat") |> json_response(200)

    assert %{
             "token" => token,
             "device_id" => 1,
             "user" => %{"name" => "Ali", "email" => "ali@test.pakchat"}
           } = body

    me = build_conn() |> put_req_header("authorization", "Bearer " <> token) |> get(~p"/api/me")
    assert json_response(me, 200)["email"] == "ali@test.pakchat"

    # Signing in again is the same account, on a "new phone".
    again = conn |> test_sign_in("ali@test.pakchat") |> json_response(200)
    assert again["user"]["id"] == body["user"]["id"]
  end

  test "can never sign in as a real Gmail address", %{conn: conn} do
    switch(true)

    assert %{"error" => "not_allowed"} =
             conn |> test_sign_in("ali@gmail.com") |> json_response(403)

    assert %{"error" => "not_allowed"} =
             conn |> test_sign_in("ali@test.pakchat.evil.com") |> json_response(403)
  end
end
