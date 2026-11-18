defmodule PakchatWeb.PinTest do
  @moduledoc "Two-step verification: the 6-digit PIN asked when an account signs in on a new phone."
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

  # A sign-in by number, its code already checked (as WhatsApp does it).
  defp phone_sign_in(phone) do
    :ok = PhoneCodes.allow(phone, "sign_in", "123456")
    build_conn() |> post(~p"/api/auth/phone", keys(%{"phone" => phone, "code" => "123456"}))
  end

  defp google_sign_in(id_token),
    do: build_conn() |> post(~p"/api/auth/google", keys(%{"id_token" => id_token}))

  defp pin(ticket, pin),
    do: build_conn() |> post(~p"/api/auth/pin", keys(%{"ticket" => ticket, "pin" => pin}))

  # Someone signed in by number, with a PIN on.
  defp with_pin(code \\ "246810") do
    phone = new_number()
    %{"token" => token} = phone |> phone_sign_in() |> json_response(200)

    assert %{"pin" => true} =
             token |> as() |> put(~p"/api/me/pin", %{"pin" => code}) |> json_response(200)

    %{phone: phone, token: token}
  end

  test "turning it on and off shows on me, and only 6 digits will do" do
    %{token: token} = person("Ali")
    assert %{"pin" => false} = token |> as() |> get(~p"/api/me") |> json_response(200)

    for bad <- ["12345", "1234567", "12a456", "", " 123456"] do
      assert token |> as() |> put(~p"/api/me/pin", %{"pin" => bad}) |> json_response(422)
    end

    assert %{"pin" => true} =
             token |> as() |> put(~p"/api/me/pin", %{"pin" => "135790"}) |> json_response(200)

    user = Repo.get_by!(User, name: "Ali")
    # Only a scrambled copy is kept.
    assert user.pin_hash =~ ~r/\Apbkdf2-sha256\$/
    refute user.pin_hash =~ "135790"

    # Off needs the PIN it has now.
    assert %{"error" => "wrong_current"} =
             token
             |> as()
             |> delete(~p"/api/me/pin", %{"current" => "000000"})
             |> json_response(403)

    assert token |> as() |> delete(~p"/api/me/pin") |> json_response(403)

    assert %{"pin" => false} =
             token
             |> as()
             |> delete(~p"/api/me/pin", %{"current" => "135790"})
             |> json_response(200)
  end

  test "changing it needs the one it has now" do
    %{phone: phone, token: token} = with_pin()
    change = fn body -> token |> as() |> put(~p"/api/me/pin", body) end

    assert %{"error" => "wrong_current"} = change.(%{"pin" => "112233"}) |> json_response(403)
    assert change.(%{"pin" => "112233", "current" => "000000"}) |> json_response(403)
    assert change.(%{"pin" => "112233", "current" => "246810"}) |> json_response(200)

    %{"ticket" => ticket} = phone |> phone_sign_in() |> json_response(403)
    assert ticket |> pin("112233") |> json_response(200)
  end

  test "signing in on a new phone asks for it, and the old phone stays in until it's right" do
    %{phone: phone, token: old} = with_pin()

    assert %{"error" => "pin_needed", "ticket" => ticket, "google" => false, "reset_at" => nil} =
             phone |> phone_sign_in() |> json_response(403)

    # Nothing changed yet.
    assert old |> as() |> get(~p"/api/me") |> json_response(200)

    assert %{"error" => "wrong_pin", "tries_left" => 4} =
             ticket |> pin("111111") |> json_response(403)

    assert %{"token" => new} = ticket |> pin("246810") |> json_response(200)
    assert new |> as() |> get(~p"/api/me") |> json_response(200)
    assert old |> as() |> get(~p"/api/me") |> json_response(401)

    # A right PIN starts the count again.
    assert Repo.get_by!(User, phone: phone).pin_failures == 0
  end

  test "Google sign-in asks for it too, without the Google way back" do
    google = google_token("Sara", %{"sub" => "sara-google"})
    %{"token" => token} = google |> google_sign_in() |> json_response(200)
    token |> as() |> put(~p"/api/me/pin", %{"pin" => "975310"}) |> json_response(200)

    assert %{"error" => "pin_needed", "ticket" => ticket, "google" => false} =
             google |> google_sign_in() |> json_response(403)

    assert ticket |> pin("975310") |> json_response(200)

    # Google can't be both the way in and the proof.
    assert build_conn()
           |> post(~p"/api/auth/pin/google", keys(%{"ticket" => ticket, "id_token" => google}))
           |> json_response(403)
  end

  test "five wrong tries are free, then each wait is twice the last" do
    %{phone: phone} = with_pin()
    %{"ticket" => ticket} = phone |> phone_sign_in() |> json_response(403)

    for left <- [4, 3, 2, 1] do
      assert %{"tries_left" => ^left} = ticket |> pin("000000") |> json_response(403)
    end

    assert %{"error" => "pin_locked", "wait" => 60} =
             ticket |> pin("000000") |> json_response(429)

    # While it waits even the right PIN isn't looked at.
    assert %{"error" => "pin_locked"} = ticket |> pin("246810") |> json_response(429)

    # A new sign-in (a new install) doesn't start the count again.
    %{"ticket" => again} = phone |> phone_sign_in() |> json_response(403)
    assert again |> pin("246810") |> json_response(429)

    # The wait is over: the next wrong one waits twice as long.
    user = Repo.get_by!(User, phone: phone)
    user |> Ecto.Changeset.change(pin_locked_until: nil) |> Repo.update!()
    assert %{"wait" => 120} = again |> pin("000000") |> json_response(429)

    user |> Ecto.Changeset.change(pin_locked_until: nil) |> Repo.update!()
    assert again |> pin("246810") |> json_response(200)
  end

  test "the longest wait is a day" do
    assert Pakchat.Pin.try_pin(%User{id: 0, pin_hash: nil}, "x") == :ok
    %{phone: phone} = with_pin()
    user = Repo.get_by!(User, phone: phone)
    user |> Ecto.Changeset.change(pin_failures: 40) |> Repo.update!()
    assert {:error, {:pin_locked, 86_400}} = Pakchat.Pin.try_pin(user, "000000")
  end

  test "a ticket that's made up, or for nobody, doesn't work" do
    assert %{"error" => "bad_ticket"} = "made-up" |> pin("246810") |> json_response(401)

    forged = Phoenix.Token.sign(PakchatWeb.Endpoint, "other", %{"u" => 1, "c" => %{}})
    assert forged |> pin("246810") |> json_response(401)
  end

  test "forgot it: the Google account linked to the number proves it's them" do
    %{phone: phone, token: token} = with_pin()
    sub = "linked-#{System.unique_integer([:positive])}"
    Repo.get_by!(User, phone: phone) |> Ecto.Changeset.change(google_sub: sub) |> Repo.update!()

    assert %{"ticket" => ticket, "google" => true} =
             phone |> phone_sign_in() |> json_response(403)

    forgot = fn id_token ->
      build_conn()
      |> post(~p"/api/auth/pin/google", keys(%{"ticket" => ticket, "id_token" => id_token}))
    end

    # Someone else's Google account won't do.
    assert %{"error" => "wrong_google"} = google_token("Other") |> forgot.() |> json_response(403)
    assert %{"error" => "bad_token"} = "not a token" |> forgot.() |> json_response(401)

    assert %{"token" => new, "user" => _} =
             google_token("Me", %{"sub" => sub}) |> forgot.() |> json_response(200)

    # In, the old phone out, and the PIN gone (they make a new one).
    assert %{"pin" => false} = new |> as() |> get(~p"/api/me") |> json_response(200)
    assert token |> as() |> get(~p"/api/me") |> json_response(401)
  end

  test "forgot it, no Google: after 7 days it signs in without it, and the PIN is gone" do
    %{phone: phone, token: old} = with_pin()
    %{"ticket" => ticket} = phone |> phone_sign_in() |> json_response(403)
    reset = fn t -> build_conn() |> post(~p"/api/auth/pin/reset", keys(%{"ticket" => t})) end

    assert %{"reset_at" => at} = ticket |> reset.() |> json_response(200)
    {:ok, at, _} = DateTime.from_iso8601(at)
    assert_in_delta DateTime.diff(at, DateTime.utc_now()), 7 * 24 * 3600, 60

    # Asking again doesn't move it later, and the next sign-in says when.
    assert %{"reset_at" => same} = ticket |> reset.() |> json_response(200)
    assert {:ok, ^at, _} = DateTime.from_iso8601(same)
    assert %{"reset_at" => ^same} = phone |> phone_sign_in() |> json_response(403)
    assert old |> as() |> get(~p"/api/me") |> json_response(200)

    # Seven days on.
    user = Repo.get_by!(User, phone: phone)

    week_ago =
      DateTime.add(DateTime.utc_now(), -7 * 24 * 3600 - 5, :second) |> DateTime.truncate(:second)

    user |> Ecto.Changeset.change(pin_reset_at: week_ago) |> Repo.update!()

    assert %{"token" => new} = phone |> phone_sign_in() |> json_response(200)
    assert %{"pin" => false} = new |> as() |> get(~p"/api/me") |> json_response(200)
    assert old |> as() |> get(~p"/api/me") |> json_response(401)
  end

  test "the reset endpoint itself signs in once the 7 days are over" do
    %{phone: phone} = with_pin()
    %{"ticket" => ticket} = phone |> phone_sign_in() |> json_response(403)

    week_ago =
      DateTime.add(DateTime.utc_now(), -8 * 24 * 3600, :second) |> DateTime.truncate(:second)

    Repo.get_by!(User, phone: phone)
    |> Ecto.Changeset.change(pin_reset_at: week_ago)
    |> Repo.update!()

    assert %{"token" => new} =
             build_conn()
             |> post(~p"/api/auth/pin/reset", keys(%{"ticket" => ticket}))
             |> json_response(200)

    assert %{"pin" => false} = new |> as() |> get(~p"/api/me") |> json_response(200)
  end

  test "the reminder on their own phone: a right answer stops a reset someone asked for" do
    %{phone: phone, token: token} = with_pin()
    %{"ticket" => ticket} = phone |> phone_sign_in() |> json_response(403)

    build_conn()
    |> post(~p"/api/auth/pin/reset", keys(%{"ticket" => ticket}))
    |> json_response(200)

    assert Repo.get_by!(User, phone: phone).pin_reset_at

    check = fn p ->
      token |> as() |> post(~p"/api/me/pin/check", %{"pin" => p}) |> json_response(200)
    end

    assert %{"right" => false} = check.("999999")
    assert Repo.get_by!(User, phone: phone).pin_reset_at
    # Wrong answers here don't count towards the wait.
    assert Repo.get_by!(User, phone: phone).pin_failures == 0

    assert %{"right" => true} = check.("246810")
    refute Repo.get_by!(User, phone: phone).pin_reset_at
    assert %{"reset_at" => nil} = phone |> phone_sign_in() |> json_response(403)
  end

  test "the reminder needs a PIN to check" do
    %{token: token} = person("Bilal")

    assert token
           |> as()
           |> post(~p"/api/me/pin/check", %{"pin" => "123456"})
           |> json_response(404)
  end

  test "a new PIN starts the count and any reset over" do
    %{phone: phone, token: token} = with_pin()

    Repo.get_by!(User, phone: phone)
    |> Ecto.Changeset.change(
      pin_failures: 7,
      pin_reset_at: DateTime.utc_now() |> DateTime.truncate(:second)
    )
    |> Repo.update!()

    token
    |> as()
    |> put(~p"/api/me/pin", %{"pin" => "112233", "current" => "246810"})
    |> json_response(200)

    user = Repo.get_by!(User, phone: phone)
    assert {user.pin_failures, user.pin_reset_at, user.pin_locked_until} == {0, nil, nil}

    %{"ticket" => ticket} = phone |> phone_sign_in() |> json_response(403)
    assert ticket |> pin("246810") |> json_response(403)
    assert ticket |> pin("112233") |> json_response(200)
  end

  test "a new account, or one without a PIN, signs in straight away" do
    assert new_number() |> phone_sign_in() |> json_response(200)
    %{"token" => _} = google_token("Zara") |> google_sign_in() |> json_response(200)
  end
end
