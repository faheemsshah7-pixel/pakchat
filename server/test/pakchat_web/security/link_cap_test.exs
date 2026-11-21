defmodule PakchatWeb.Security.LinkCapTest do
  @moduledoc """
  Each website waiting to be linked keeps its keys in memory for a few minutes.
  A total cap stops a script (from many addresses) eating the server's memory.
  """
  use ExUnit.Case, async: false
  alias Pakchat.Linking

  setup do
    saved = Application.get_env(:pakchat, :link_waiting_max)
    Application.put_env(:pakchat, :link_waiting_max, 2)

    on_exit(fn ->
      if saved,
        do: Application.put_env(:pakchat, :link_waiting_max, saved),
        else: Application.delete_env(:pakchat, :link_waiting_max)
    end)
  end

  test "only so many websites may wait at once" do
    :ets.match_delete(Pakchat.Linking, :_)
    assert %{id: _} = Linking.start(%{}, %{ec: [], kyber: []})
    assert %{id: _} = Linking.start(%{}, %{ec: [], kyber: []})
    assert {:error, :unavailable} = Linking.start(%{}, %{ec: [], kyber: []})
  end
end
