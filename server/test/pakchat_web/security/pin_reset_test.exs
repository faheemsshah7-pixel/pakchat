defmodule PakchatWeb.Security.PinResetTest do
  @moduledoc """
  "Forgot PIN" without Google starts a 7-day wait. Anyone with the number's code
  can start it, so the account's phone is told at once, and the phone simply
  being used (connecting) cancels it: only a phone that is really lost lets
  the wait run out.
  """
  use PakchatWeb.ChannelCase
  import Pakchat.Fixtures
  alias Pakchat.Accounts.User
  alias PakchatWeb.Params
  alias Pakchat.{Accounts, Pin, PhoneCodes, Repo}

  defp attacker_device do
    {:ok, attrs} = Params.device(device_params())
    attrs
  end

  setup do
    vic = person("Vic")
    phone = "+92300" <> String.pad_leading("#{System.unique_integer([:positive])}", 7, "0")
    {:ok, user} = vic.user |> Ecto.Changeset.change(phone: phone) |> Repo.update()
    {:ok, user} = Pin.set(user, "246810")
    %{vic: %{vic | user: user}, phone: phone}
  end

  defp start_reset(phone) do
    :ok = PhoneCodes.allow(phone, "sign_in", "123456")

    assert {:error, {:pin_needed, %{ticket: ticket}}} =
             Accounts.sign_in_with_phone(phone, "123456", attacker_device())

    assert {:ok, {:waiting, _at}} = Accounts.sign_in_after_pin_reset(ticket, attacker_device())
    ticket
  end

  test "the phone is told at once when someone starts a reset", %{vic: vic, phone: phone} do
    _socket = online(vic.token, vic.device)
    start_reset(phone)
    assert_push "pin_reset", %{reset_at: %DateTime{}}, 1000
  end

  test "the phone connecting cancels a reset someone else started", %{vic: vic, phone: phone} do
    start_reset(phone)
    assert Repo.get!(User, vic.user.id).pin_reset_at

    _socket = online(vic.token, vic.device)
    refute Repo.get!(User, vic.user.id).pin_reset_at
    # Woken while closed: it is told on joining, so it can say so.
    assert_push "pin_reset", %{reset_at: nil}, 1000
  end

  test "the phone already connected stops the reset at once", %{vic: vic, phone: phone} do
    _socket = online(vic.token, vic.device)
    start_reset(phone)
    assert_push "pin_reset", _, 1000
    refute Repo.get!(User, vic.user.id).pin_reset_at
  end

  test "a linked website connecting does not cancel it", %{vic: vic, phone: phone} do
    web = linked(vic.user)
    start_reset(phone)
    _socket = online(web.token, web.device)
    assert Repo.get!(User, vic.user.id).pin_reset_at
  end
end
