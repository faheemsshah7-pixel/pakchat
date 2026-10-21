defmodule PakchatWeb.AuthControllerTest do
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures
  alias Pakchat.GoogleFake

  defp sign_in(conn, id_token, device \\ device_params()) do
    post(conn, ~p"/api/auth/google", %{
      "id_token" => id_token,
      "device" => device,
      "pre_keys" => pre_keys(1, 5),
      "kyber_pre_keys" => kyber_pre_keys(1, 5)
    })
  end

  test "signing in with Google gives a token that works", %{conn: conn} do
    body = conn |> sign_in(google_token("Ali")) |> json_response(200)
    assert %{"token" => token, "device_id" => 1, "user" => %{"name" => "Ali"}} = body
    # The live connection needs the device's own id.
    assert body["device_uuid"] == Pakchat.Accounts.device_by_token(token).id

    me = build_conn() |> put_req_header("authorization", "Bearer " <> token) |> get(~p"/api/me")
    assert json_response(me, 200)["name"] == "Ali"
  end

  test "tokens Google didn't make for PakChat are refused", %{conn: conn} do
    now = System.system_time(:second)
    other_key = JOSE.JWK.generate_key({:rsa, 2048})
    claims = %{"sub" => "1", "email" => "x@gmail.com"}

    bad = [
      # Signed by someone pretending to be Google.
      GoogleFake.token(claims, jwk: other_key),
      # Made for a different app.
      GoogleFake.token(Map.put(claims, "aud", "someone-else.apps.googleusercontent.com")),
      # Made by someone who isn't Google.
      GoogleFake.token(Map.put(claims, "iss", "https://evil.example")),
      # Ran out an hour ago.
      GoogleFake.token(Map.put(claims, "exp", now - 3600)),
      # Gmail address not checked by Google.
      GoogleFake.token(Map.put(claims, "email_verified", false)),
      # A key Google doesn't have.
      GoogleFake.token(claims, kid: "made-up"),
      "not even a token"
    ]

    for token <- bad do
      assert %{"error" => "bad_token"} = conn |> sign_in(token) |> json_response(401)
    end
  end

  test "keys of the wrong size are refused", %{conn: conn} do
    device = put_in(device_params()["identity_key"], b64(10))

    assert %{"fields" => %{"identity_key" => _}} =
             conn |> sign_in(google_token("Ali"), device) |> json_response(422)
  end

  test "signing in on a new phone signs the old phone and linked devices out", %{conn: conn} do
    google = google_token("Ali", %{"sub" => "ali-google"})
    %{"token" => old} = conn |> sign_in(google) |> json_response(200)
    %{"token" => new} = build_conn() |> sign_in(google) |> json_response(200)

    get_me = fn token ->
      build_conn() |> put_req_header("authorization", "Bearer " <> token) |> get(~p"/api/me")
    end

    assert get_me.(old).status == 401
    assert get_me.(new).status == 200
  end

  test "signing out stops the token working", %{conn: conn} do
    %{"token" => token} = conn |> sign_in(google_token("Ali")) |> json_response(200)
    authed = fn -> build_conn() |> put_req_header("authorization", "Bearer " <> token) end

    assert authed.() |> delete(~p"/api/auth/session") |> response(204)
    assert authed.() |> get(~p"/api/me") |> json_response(401)
  end

  test "everything else needs a token", %{conn: conn} do
    assert conn |> get(~p"/api/me") |> json_response(401)
    assert conn |> get(~p"/api/chats") |> json_response(401)

    assert conn
           |> put_req_header("authorization", "Bearer made-up")
           |> get(~p"/api/chats")
           |> json_response(401)
  end

  test "only PakChat's own websites may call the server from a browser", %{conn: conn} do
    ours = conn |> put_req_header("origin", "http://localhost:5173") |> options("/api/me")
    assert ours.status == 204
    assert get_resp_header(ours, "access-control-allow-origin") == ["http://localhost:5173"]

    theirs =
      build_conn() |> put_req_header("origin", "https://evil.example") |> options("/api/me")

    assert get_resp_header(theirs, "access-control-allow-origin") == []
  end
end
