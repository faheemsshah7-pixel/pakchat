defmodule PakchatWeb.Security.DeletePinTest do
  @moduledoc """
  The Delete account web page proves the number only. An account with a
  two-step PIN also needs its PIN there, like signing in on a new phone.
  """
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures
  alias Pakchat.Accounts.User
  alias Pakchat.{Pin, PhoneCodes, Repo}

  setup do
    vic = person("Vic")
    phone = "+92300" <> String.pad_leading("#{System.unique_integer([:positive])}", 7, "0")
    {:ok, user} = vic.user |> Ecto.Changeset.change(phone: phone) |> Repo.update()
    {:ok, user} = Pin.set(user, "246810")
    %{user: user, phone: phone}
  end

  defp delete_by_web(phone, extra) do
    :ok = PhoneCodes.allow(phone, "delete", "777777")

    build_conn()
    |> post(~p"/api/account/delete", Map.merge(%{"phone" => phone, "code" => "777777"}, extra))
  end

  test "a PIN account isn't deleted with only the number's proof", %{user: user, phone: phone} do
    assert %{"error" => "pin_needed"} = phone |> delete_by_web(%{}) |> json_response(403)
    assert Repo.get(User, user.id)

    assert %{"error" => "wrong_pin"} =
             phone |> delete_by_web(%{"pin" => "000000"}) |> json_response(403)

    assert Repo.get(User, user.id)

    assert phone |> delete_by_web(%{"pin" => "246810"}) |> response(204)
    refute Repo.get(User, user.id)
  end
end
