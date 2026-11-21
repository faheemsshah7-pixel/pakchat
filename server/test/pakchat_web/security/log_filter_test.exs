defmodule PakchatWeb.Security.LogFilterTest do
  @moduledoc """
  Secrets must never reach the server logs: session tokens (socket connect),
  link secrets, sign-in codes, PINs and Google tokens (request parameters).
  """
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog

  @secrets %{
    "token" => "tok-SECRET-1",
    "t" => "t-SECRET-2",
    "secret" => "sec-SECRET-3",
    "pin" => "pin-SECRET-4",
    "current" => "cur-SECRET-5",
    "code" => "code-SECRET-6",
    "id_token" => "idt-SECRET-7",
    "password" => "pw-SECRET-8",
    "claim" => "claim-SECRET-9",
    "pairing_code" => "pair-SECRET-10",
    "ticket" => "tick-SECRET-11",
    "sealed" => "seal-SECRET-12",
    "phone" => "+92300SECRET13",
    "email" => "SECRET14@example.com",
    "somethingnew" => "new-SECRET-15"
  }

  setup do
    level = Logger.level()
    Logger.configure(level: :info)
    on_exit(fn -> Logger.configure(level: level) end)
  end

  test "request parameters with secrets are filtered" do
    filtered = Phoenix.Logger.filter_values(Map.put(@secrets, "chat_id", "c1"))
    assert filtered["chat_id"] == "c1"

    for {key, _} <- @secrets do
      assert filtered[key] == "[FILTERED]", "#{key} is not filtered"
    end
  end

  test "a socket connect does not write the session token into the log" do
    log =
      capture_log(fn ->
        :telemetry.execute([:phoenix, :socket_connected], %{duration: 1000}, %{
          endpoint: PakchatWeb.Endpoint,
          transport: :websocket,
          params: %{"token" => "tok-SECRET-1", "vsn" => "2.0.0"},
          connect_info: %{},
          vsn: "2.0.0",
          user_socket: PakchatWeb.DeviceSocket,
          result: :ok,
          serializer: Phoenix.Socket.V2.JSONSerializer,
          log: :info
        })
      end)

    refute log =~ "SECRET"
  end

  test "the device and link sockets do not log connects" do
    for socket <- [PakchatWeb.DeviceSocket, PakchatWeb.LinkSocket] do
      {_path, ^socket, opts} =
        Enum.find(PakchatWeb.Endpoint.__sockets__(), fn {_, s, _} -> s == socket end)

      assert opts[:websocket][:log] == false, "#{inspect(socket)} logs connects"
    end
  end

  test "the unused LiveView socket is not open outside development" do
    refute Enum.any?(PakchatWeb.Endpoint.__sockets__(), fn {path, _, _} -> path == "/live" end)
  end
end
