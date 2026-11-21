defmodule PakchatWeb.Security.PhoneOnlyTest do
  @moduledoc """
  A linked website (a browser left signed in) must not change how the account
  signs in or its PIN: only the phone (device 1) may, like delete already.
  """
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures

  defp as(token), do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  test "a linked website can't add a Gmail, add or remove a number, or touch the PIN" do
    ali = person("Ali")
    web = linked(ali.user)

    attempts = [
      fn c ->
        put(c, ~p"/api/me/google", %{"id_token" => google_token("Attacker"), "move" => true})
      end,
      fn c -> post(c, ~p"/api/me/phone/code", %{"phone" => "+923001234567"}) end,
      fn c -> put(c, ~p"/api/me/phone", %{"phone" => "+923001234567", "code" => "123456"}) end,
      fn c -> delete(c, ~p"/api/me/google") end,
      fn c -> delete(c, ~p"/api/me/phone") end,
      fn c -> put(c, ~p"/api/me/pin", %{"pin" => "135790"}) end,
      fn c -> delete(c, ~p"/api/me/pin", %{"current" => "135790"}) end
    ]

    for attempt <- attempts do
      assert web.token |> as() |> attempt.() |> json_response(403)
    end

    # The phone still can.
    assert %{"pin" => true} =
             ali.token |> as() |> put(~p"/api/me/pin", %{"pin" => "135790"}) |> json_response(200)
  end
end
