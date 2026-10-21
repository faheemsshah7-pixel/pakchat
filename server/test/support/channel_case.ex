defmodule PakchatWeb.ChannelCase do
  @moduledoc """
  Setup for tests of the live connection (sockets and channels).
  """
  use ExUnit.CaseTemplate
  alias Ecto.Adapters.SQL.Sandbox
  alias Phoenix.ChannelTest

  using do
    quote do
      import Phoenix.ChannelTest
      import PakchatWeb.ChannelCase
      import Pakchat.Fixtures

      @endpoint PakchatWeb.Endpoint
    end
  end

  setup tags do
    owner = Sandbox.start_owner!(Pakchat.Repo, shared: not tags[:async])

    # Remember every channel a test opens. When the test ends, wait for them
    # to finish closing before the test's database goes away.
    {:ok, opened} = Agent.start(fn -> [] end)
    Process.put(:opened_channels, opened)

    on_exit(fn ->
      for pid <- Agent.get(opened, & &1) do
        ref = Process.monitor(pid)
        receive do: ({:DOWN, ^ref, _, _, _} -> :ok), after: (1000 -> :ok)
      end

      Agent.stop(opened)
      Sandbox.stop_owner(owner)
    end)

    :ok
  end

  @doc "Connects a device and joins its own channel, like the app does."
  def online(token, device, params \\ %{}) do
    {:ok, socket} =
      ChannelTest.__connect__(
        PakchatWeb.Endpoint,
        PakchatWeb.DeviceSocket,
        %{"token" => token},
        []
      )

    {:ok, _, socket} =
      ChannelTest.subscribe_and_join(socket, "device:" <> device.id, params)

    # Not linked, so when the test ends the channel closes the normal way
    # (as when a phone's connection drops) instead of being killed.
    Process.unlink(socket.channel_pid)
    Agent.update(Process.get(:opened_channels), &[socket.channel_pid | &1])
    socket
  end
end
