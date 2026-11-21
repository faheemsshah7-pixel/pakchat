defmodule PakchatWeb.Security.PhotoOwnerTest do
  @moduledoc """
  A `photo` value names a photo file. Someone must not set their photo (or a
  group's) to another person's photo file, and changing a photo must never
  delete a file someone else still uses.
  """
  use PakchatWeb.ConnCase, async: true
  import Pakchat.Fixtures
  alias Pakchat.{Accounts, Chats, Files}

  defp as(token), do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  setup do
    victim = person("Victim")
    {:ok, file} = Files.start_photo(victim.user, nil, 1000)
    value = "pk1:#{file.id}:key:digest"
    {:ok, _} = Accounts.update_profile(victim.user, %{"photo" => value})
    %{victim: victim, photo: file, value: value}
  end

  test "someone else's photo file can't be set as my photo, and so can't be deleted", ctx do
    mallory = person("Mallory")

    me =
      mallory.token |> as() |> patch(~p"/api/me", %{"photo" => ctx.value}) |> json_response(200)

    refute me["photo"] == ctx.value

    mallory.token |> as() |> patch(~p"/api/me", %{"photo" => nil}) |> json_response(200)
    assert Files.get(ctx.photo.id)
  end

  test "nor as a group's photo", ctx do
    mallory = person("Mallory")
    {:ok, group} = Chats.create_group(mallory.user, %{"title" => "G"}, [])
    {:ok, updated} = Chats.update_group(mallory.user, group.id, %{"photo" => ctx.value})
    refute updated.photo == ctx.value
    {:ok, _} = Chats.update_group(mallory.user, group.id, %{"photo" => nil})
    assert Files.get(ctx.photo.id)
  end

  test "a photo still in use is never deleted", ctx do
    Files.forget_photo(ctx.value)
    assert Files.get(ctx.photo.id)
  end

  test "my own photo still works, and the old one goes when I change it", ctx do
    {:ok, new} = Files.start_photo(ctx.victim.user, nil, 1000)
    new_value = "pk1:#{new.id}:key:digest"

    assert %{"photo" => ^new_value} =
             ctx.victim.token
             |> as()
             |> patch(~p"/api/me", %{"photo" => new_value})
             |> json_response(200)

    refute Files.get(ctx.photo.id)
  end
end
