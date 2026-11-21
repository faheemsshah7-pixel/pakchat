defmodule PakchatWeb.Security.MovePinTest do
  @moduledoc """
  "Move it here" takes a number or Gmail off another account. When that account
  has a two-step PIN, its PIN is needed too: a SIM swap (or a copied code) must
  not let someone move the victim's number to their own account.
  """
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures
  alias Pakchat.Accounts.User
  alias Pakchat.{PhoneCodes, Repo}

  defp as(token), do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  defp keys(body) do
    Map.merge(body, %{
      "device" => device_params(),
      "pre_keys" => pre_keys(1, 3),
      "kyber_pre_keys" => kyber_pre_keys(1, 3)
    })
  end

  defp new_number do
    "+92300" <> String.pad_leading("#{System.unique_integer([:positive])}", 7, "0")
  end

  # The victim: signed in by number, PIN on.
  defp victim do
    phone = new_number()
    :ok = PhoneCodes.allow(phone, "sign_in", "123456")

    %{"token" => token} =
      build_conn()
      |> post(~p"/api/auth/phone", keys(%{"phone" => phone, "code" => "123456"}))
      |> json_response(200)

    token |> as() |> put(~p"/api/me/pin", %{"pin" => "246810"}) |> json_response(200)
    %{phone: phone, token: token, user: Repo.get_by!(User, phone: phone)}
  end

  defp move_phone(token, phone, extra) do
    :ok = PhoneCodes.allow(phone, "link", "654321")

    token
    |> as()
    |> put(
      ~p"/api/me/phone",
      Map.merge(%{"phone" => phone, "code" => "654321", "move" => true}, extra)
    )
  end

  test "moving a number off an account with a PIN needs that PIN" do
    v = victim()
    mallory = person("Mallory")

    # Right code (the SIM), no PIN: refused, nothing moves.
    assert %{"error" => "pin_needed"} =
             mallory.token |> move_phone(v.phone, %{}) |> json_response(403)

    assert Repo.get!(User, v.user.id).phone == v.phone

    # A wrong PIN: refused and counted.
    assert %{"error" => "wrong_pin"} =
             mallory.token |> move_phone(v.phone, %{"pin" => "000000"}) |> json_response(403)

    assert Repo.get!(User, v.user.id).phone == v.phone
    assert Repo.get!(User, v.user.id).pin_failures == 1

    # The right PIN (it really is theirs): it moves.
    assert %{"phone" => phone} =
             mallory.token |> move_phone(v.phone, %{"pin" => "246810"}) |> json_response(200)

    assert phone == v.phone
  end

  test "the app asks for the PIN after the code: the same code still works with it" do
    v = victim()
    mallory = person("Mallory")
    # One code, as from one SMS or one WhatsApp check.
    :ok = PhoneCodes.allow(v.phone, "link", "112233")

    send_it = fn extra ->
      mallory.token
      |> as()
      |> put(
        ~p"/api/me/phone",
        Map.merge(%{"phone" => v.phone, "code" => "112233", "move" => true}, extra)
      )
    end

    assert %{"error" => "pin_needed"} = send_it.(%{}) |> json_response(403)
    assert %{"error" => "wrong_pin"} = send_it.(%{"pin" => "000000"}) |> json_response(403)
    assert %{"phone" => phone} = send_it.(%{"pin" => "246810"}) |> json_response(200)
    assert phone == v.phone
    # Used up now.
    assert %{"error" => "wrong_code"} = send_it.(%{"pin" => "246810"}) |> json_response(422)
  end

  test "moving a Gmail off an account with a PIN needs that PIN" do
    owner = person("Owner")
    owner.token |> as() |> put(~p"/api/me/pin", %{"pin" => "135790"}) |> json_response(200)

    # Someone signed in by number, moving the owner's Gmail to their account.
    phone = new_number()
    :ok = PhoneCodes.allow(phone, "sign_in", "123456")

    %{"token" => other} =
      build_conn()
      |> post(~p"/api/auth/phone", keys(%{"phone" => phone, "code" => "123456"}))
      |> json_response(200)

    owner_token =
      google_token("Owner", %{"sub" => owner.user.google_sub, "email" => owner.user.email})

    move = fn extra ->
      other
      |> as()
      |> put(
        ~p"/api/me/google",
        Map.merge(%{"id_token" => owner_token, "move" => true}, extra)
      )
    end

    assert %{"error" => "pin_needed"} = move.(%{}) |> json_response(403)
    assert Repo.get!(User, owner.user.id).google_sub
    assert move.(%{"pin" => "135790"}) |> json_response(200)
  end
end
