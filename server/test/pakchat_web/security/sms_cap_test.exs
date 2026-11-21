defmodule PakchatWeb.Security.SmsCapTest do
  @moduledoc """
  The whole-server SMS cap can be used up by a script asking codes for random
  numbers, so nobody can sign in by SMS that day. Codes from the WhatsApp check
  cost nothing and must not count, and one address block only gets a few SMS a day.
  """
  use PakchatWeb.ConnCase, async: false
  alias Pakchat.PhoneCodes

  setup do
    cap = Application.get_env(:pakchat, :sms_daily_cap)
    limits = Application.fetch_env!(:pakchat, :rate_limits)

    on_exit(fn ->
      Application.put_env(:pakchat, :rate_limits, limits)

      if cap,
        do: Application.put_env(:pakchat, :sms_daily_cap, cap),
        else: Application.delete_env(:pakchat, :sms_daily_cap)
    end)

    %{limits: limits}
  end

  defp number, do: "+92300" <> String.pad_leading("#{System.unique_integer([:positive])}", 7, "0")

  test "WhatsApp-proved codes don't use up the SMS cap" do
    Application.put_env(:pakchat, :sms_daily_cap, 2)
    for _ <- 1..3, do: :ok = PhoneCodes.allow(number(), "sign_in", "123456")
    assert {:ok, _} = PhoneCodes.send_code(number(), "sign_in")
  end

  test "one address block gets only a few SMS codes a day", %{limits: limits} do
    Application.put_env(:pakchat, :rate_limits, Keyword.put(limits, :sms_day, {3, 86_400_000}))

    statuses =
      for n <- 1..5 do
        build_conn()
        |> Map.put(:remote_ip, {203, 0, 113, n})
        |> post(~p"/api/auth/phone/code", %{"phone" => number()})
        |> Map.get(:status)
      end

    assert Enum.take(statuses, 3) == [200, 200, 200]
    assert Enum.drop(statuses, 3) == [429, 429]
  end
end
