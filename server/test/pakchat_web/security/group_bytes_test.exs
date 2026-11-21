defmodule PakchatWeb.Security.GroupBytesTest do
  @moduledoc """
  A group message is stored once for every member's device. A sender spamming
  big messages into a big group must not fill the database: what each person's
  messages make the server store is limited in bytes, and nothing is stored
  when the disk is nearly full.
  """
  # Not async: it changes the limits for a moment.
  use Pakchat.DataCase, async: false
  import Pakchat.Fixtures
  alias Pakchat.{Chats, Relay}

  setup do
    limits = Application.fetch_env!(:pakchat, :rate_limits)
    min_free = Application.get_env(:pakchat, :min_free_mb)

    on_exit(fn ->
      Application.put_env(:pakchat, :rate_limits, limits)

      if min_free,
        do: Application.put_env(:pakchat, :min_free_mb, min_free),
        else: Application.delete_env(:pakchat, :min_free_mb)
    end)

    ali = person("Ali")
    others = for n <- 1..4, do: person("Member #{n}")

    {:ok, group} =
      Chats.create_group(ali.user, %{"title" => "Big"}, Enum.map(others, & &1.user.id))

    %{ali: ali, group: group, limits: limits}
  end

  defp send_group(ali, group, bytes) do
    Relay.send_message(ali.device, group.id, %{
      kind: "message",
      envelopes: [],
      group: %{type: 7, body: :binary.copy("x", bytes)}
    })
  end

  test "a person's messages can only make the server store so many bytes", ctx do
    # 4 other devices: each 3,000-byte message stores 12,000 bytes.
    Application.put_env(
      :pakchat,
      :rate_limits,
      Keyword.merge(ctx.limits, stored_bytes: {30_000, 3_600_000})
    )

    assert {:ok, _} = send_group(ctx.ali, ctx.group, 3000)
    assert {:ok, _} = send_group(ctx.ali, ctx.group, 3000)
    assert {:error, :rate_limited} = send_group(ctx.ali, ctx.group, 3000)
  end

  test "nothing is stored when the disk is nearly full", ctx do
    Application.put_env(:pakchat, :min_free_mb, 1_000_000_000)
    assert {:error, :storage_full} = send_group(ctx.ali, ctx.group, 100)
  end
end
