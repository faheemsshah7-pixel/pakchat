defmodule PakchatWeb.DeleteAccountTest do
  @moduledoc """
  Deleting an account (Phase 11, which Google Play asks for): from the phone in
  Settings › Account › Delete my account, after typing my number (or my Gmail),
  and from the Delete account web page, after WhatsApp proves the number.
  """
  # Not async: it changes the WhatsApp settings.
  use PakchatWeb.ConnCase, async: false
  import Pakchat.Fixtures
  import Ecto.Query
  alias Pakchat.{Accounts, Files, Repo}
  alias Pakchat.Accounts.{Device, User}

  @secret "meta-app-secret"
  @settings [number: "923000000000", app_secret: @secret, verify_token: "made-up-word"]

  setup do
    Application.put_env(:pakchat, :whatsapp, @settings)
    on_exit(fn -> Application.delete_env(:pakchat, :whatsapp) end)
    :ok
  end

  defp authed(token), do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  defp delete_me(token, confirm),
    do: authed(token) |> delete(~p"/api/me", %{"confirm" => confirm})

  # Gives a person a phone number (as if they'd added it with a code).
  defp with_phone(%User{} = user, phone) do
    {:ok, user} = user |> User.link_phone_changeset(%{phone: phone}) |> Repo.update()
    user
  end

  # Meta telling us the number sent the code.
  defp whatsapp_sends(from, code) do
    body =
      Jason.encode!(%{
        "entry" => [
          %{
            "changes" => [
              %{
                "value" => %{
                  "messages" => [
                    %{
                      "from" => from,
                      "type" => "text",
                      "text" => %{"body" => "PakChat code: " <> code}
                    }
                  ]
                }
              }
            ]
          }
        ]
      })

    signature =
      "sha256=" <> (:crypto.mac(:hmac, :sha256, @secret, body) |> Base.encode16(case: :lower))

    build_conn()
    |> put_req_header("content-type", "application/json")
    |> put_req_header("x-hub-signature-256", signature)
    |> post(~p"/api/whatsapp/webhook", body)
    |> response(200)
  end

  # The web page's whole WhatsApp check for a number: start, send, claim. Returns the secret.
  defp proved(phone, typed \\ nil) do
    check =
      build_conn()
      |> post(~p"/api/auth/whatsapp", %{"purpose" => "delete", "phone" => typed || phone})
      |> json_response(200)

    whatsapp_sends(String.trim_leading(phone, "+"), check["code"])

    assert %{"status" => "done", "phone" => ^phone} =
             build_conn()
             |> post(~p"/api/auth/whatsapp/#{check["id"]}", %{"secret" => check["secret"]})
             |> json_response(200)

    check["secret"]
  end

  describe "from the phone (DELETE /api/me)" do
    test "deletes the account once I type my own number, and signs every device out" do
      %{user: user, token: token} = person("Ali")
      user = with_phone(user, "+923001234567")
      %{token: web_token} = linked(user)

      # A wrong number, or none, deletes nothing.
      assert %{"error" => "wrong_confirm"} =
               delete_me(token, "0300 7654321") |> json_response(422)

      assert %{"error" => "wrong_confirm"} =
               authed(token) |> delete(~p"/api/me") |> json_response(422)

      assert Repo.get(User, user.id)

      # Typed any way people type it.
      assert delete_me(token, "0300-1234567") |> response(204)

      refute Repo.get(User, user.id)
      refute Repo.exists?(from d in Device, where: d.user_id == ^user.id)
      # Both tokens are gone.
      assert authed(token) |> get(~p"/api/me") |> response(401)
      assert authed(web_token) |> get(~p"/api/me") |> response(401)
    end

    test "with no number, my Gmail confirms it (any capitals)" do
      %{user: user, token: token} = person("Sara")
      assert user.phone == nil

      assert delete_me(token, "someone@gmail.com") |> json_response(422)
      assert delete_me(token, "  " <> String.upcase(user.email) <> " ") |> response(204)
      refute Repo.get(User, user.id)
    end

    test "with a number, the Gmail isn't enough (like WhatsApp, the number confirms)" do
      %{user: user, token: token} = person("Bilal")
      user = with_phone(user, "+923001112223")

      assert delete_me(token, user.email) |> json_response(422)
      assert Repo.get(User, user.id)
    end

    test "a linked website can't delete the account" do
      %{user: user} = person("Hina")
      user = with_phone(user, "+923004445556")
      %{token: web_token} = linked(user)

      assert delete_me(web_token, "+923004445556") |> json_response(403)
      assert Repo.get(User, user.id)
    end

    test "the others keep the group, and it keeps an admin" do
      %{user: me, token: token} = person("Usman")
      %{user: friend} = person("Zara")

      {:ok, group} = Pakchat.Chats.create_group(me, %{"title" => "Class"}, [friend.id])
      assert delete_me(token, me.email) |> response(204)

      members = Pakchat.Chats.member_ids(group.id)
      assert members == [friend.id]
      assert Pakchat.Chats.role(group.id, friend.id) == "admin"
    end
  end

  describe "my files" do
    defp put_bytes(url, size) do
      build_conn()
      |> put_req_header("content-type", "application/octet-stream")
      |> put(url, :crypto.strong_rand_bytes(size))
    end

    # Makes room for a file (a photo, an attachment or a backup) and, unless `upload: false`, uploads it.
    defp file(token, path, params, upload \\ true) do
      %{"id" => id, "upload_url" => url} =
        authed(token) |> post(path, Map.put(params, "size", 1000)) |> json_response(200)

      if upload, do: assert(put_bytes(url, 1000).status == 204)
      id
    end

    defp gone?(id), do: Files.get(id) == nil and not File.exists?(Files.path(id))

    defp fetch(token, id) do
      %{"url" => url} = authed(token) |> get(~p"/api/files/#{id}/link") |> json_response(200)
      byte_size(build_conn() |> get(url) |> response(200))
    end

    test "the group keeps the photo I set, and the others keep what I already sent" do
      %{user: me, token: token} = person("Faisal")
      %{user: friend, token: friend_token} = person("Ayesha")
      {:ok, group} = Pakchat.Chats.create_group(me, %{"title" => "Family"}, [friend.id])

      group_photo = file(token, ~p"/api/photos", %{"chat_id" => group.id})
      value = "pk1:#{group_photo}:a2V5:ZGlnZXN0"

      authed(token)
      |> patch(~p"/api/groups/#{group.id}", %{"photo" => value})
      |> json_response(200)

      sent = file(token, ~p"/api/files", %{"chat_id" => group.id})
      {:ok, direct} = Pakchat.Chats.get_or_create_direct(me, friend.id)
      sent_to_her = file(token, ~p"/api/files", %{"chat_id" => direct.id})
      half_sent = file(token, ~p"/api/files", %{"chat_id" => group.id}, false)
      never_used = file(token, ~p"/api/photos", %{"chat_id" => group.id})
      my_photo = file(token, ~p"/api/photos", %{})

      authed(token)
      |> patch(~p"/api/me", %{"photo" => "pk1:#{my_photo}:a2V5:ZGlnZXN0"})
      |> json_response(200)

      backup = file(token, ~p"/api/backup", %{})

      {:ok, status} = Pakchat.Chats.set_status_audience(me, [friend.id])
      on_status = file(token, ~p"/api/files", %{"chat_id" => status.id})

      assert delete_me(token, me.email) |> response(204)

      # Still the group's photo, and Ayesha can still open it and what I sent.
      assert (authed(friend_token)
              |> get(~p"/api/chats/#{group.id}")
              |> json_response(200))["photo"] == value

      assert fetch(friend_token, group_photo) == 1000
      assert fetch(friend_token, sent) == 1000
      assert fetch(friend_token, sent_to_her) == 1000
      assert %{owner_id: nil} = Files.get(group_photo)
      assert %{owner_id: nil, expires_at: %DateTime{}} = Files.get(sent)

      # Everything else of mine is gone, bytes too, and so is my status.
      for id <- [half_sent, never_used, my_photo, backup, on_status], do: assert(gone?(id))
      refute Repo.get(Pakchat.Chats.Chat, status.id)

      # A new photo still replaces mine (and deletes it), and Ayesha can still delete her account.
      new_photo = file(friend_token, ~p"/api/photos", %{"chat_id" => group.id})

      authed(friend_token)
      |> patch(~p"/api/groups/#{group.id}", %{"photo" => "pk1:#{new_photo}:a2V5:ZGlnZXN0"})
      |> json_response(200)

      assert gone?(group_photo)
      assert delete_me(friend_token, friend.email) |> response(204)
      assert gone?(new_photo)
      # What I sent stays until its 30 days are up, like any file.
      assert Files.get(sent)
    end
  end

  describe "from the web page (POST /api/account/delete)" do
    test "deletes the account on the number WhatsApp proved" do
      %{user: user} = person("Kamran")
      user = with_phone(user, "+923009998887")

      secret = proved("+923009998887")

      assert build_conn()
             |> post(~p"/api/account/delete", %{"phone" => "03009998887", "code" => secret})
             |> response(204)

      refute Repo.get(User, user.id)

      # The code works once.
      assert build_conn()
             |> post(~p"/api/account/delete", %{"phone" => "+923009998887", "code" => secret})
             |> json_response(422)
    end

    test "says when no account has that number" do
      secret = proved("+923001010101")

      assert %{"error" => "no_account"} =
               build_conn()
               |> post(~p"/api/account/delete", %{"phone" => "+923001010101", "code" => secret})
               |> json_response(404)
    end

    test "a made-up code, or a sign-in code, deletes nothing" do
      %{user: user} = person("Nadia")
      user = with_phone(user, "+923002223334")

      assert build_conn()
             |> post(~p"/api/account/delete", %{"phone" => "+923002223334", "code" => "nope"})
             |> json_response(422)

      # A check started for signing in can't be used to delete.
      check =
        build_conn()
        |> post(~p"/api/auth/whatsapp", %{"purpose" => "sign_in", "phone" => "+923002223334"})
        |> json_response(200)

      whatsapp_sends("923002223334", check["code"])

      build_conn()
      |> post(~p"/api/auth/whatsapp/#{check["id"]}", %{"secret" => check["secret"]})
      |> json_response(200)

      assert build_conn()
             |> post(~p"/api/account/delete", %{
               "phone" => "+923002223334",
               "code" => check["secret"]
             })
             |> json_response(422)

      assert Repo.get(User, user.id)
      assert build_conn() |> post(~p"/api/account/delete", %{}) |> json_response(400)
    end

    test "another number's code can't delete my account" do
      %{user: user} = person("Asad")
      user = with_phone(user, "+923005556667")

      secret = proved("+923007778889")

      assert build_conn()
             |> post(~p"/api/account/delete", %{"phone" => "+923005556667", "code" => secret})
             |> json_response(422)

      assert Repo.get(User, user.id)
      assert Accounts.delete_by_phone(nil, nil) == {:error, :bad_request}
    end
  end
end
