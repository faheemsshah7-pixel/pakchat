defmodule PakchatWeb.Phase5Test do
  @moduledoc """
  Phase 5: phone-number sign-in and its limits, one account with Gmail and
  number, finding people by number and from the phone's contacts, files and backups.
  """
  # Not async: it switches test sign-in on (to read the printed codes) and changes limits.
  use PakchatWeb.ConnCase, async: false
  import Pakchat.Fixtures
  alias Pakchat.{Accounts, Chats, Files, Phone, Relay}
  alias Pakchat.Sms.Terminal

  setup do
    Application.put_env(:pakchat, :test_sign_in, true)
    on_exit(fn -> Application.delete_env(:pakchat, :test_sign_in) end)
    :ok
  end

  defp as(%{token: token}),
    do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  defp code_for(phone) do
    {:ok, phone} = Phone.normalize(phone)
    Terminal.last_code(phone)
  end

  defp phone_sign_in(phone, code \\ nil) do
    build_conn()
    |> post(~p"/api/auth/phone", %{
      "phone" => phone,
      "code" => code || code_for(phone),
      "device" => device_params(),
      "pre_keys" => pre_keys(1, 3),
      "kyber_pre_keys" => kyber_pre_keys(1, 3)
    })
  end

  defp send_code(phone),
    do: build_conn() |> post(~p"/api/auth/phone/code", %{"phone" => phone})

  # Codes are refused within 30 seconds of the last one; tests move the last one back.
  defp age_codes do
    Pakchat.Repo.update_all(Pakchat.PhoneCodes.Code,
      set: [inserted_at: DateTime.add(DateTime.utc_now(), -60, :second)]
    )
  end

  describe "phone numbers" do
    test "are tidied the same way however they're typed" do
      for typed <- [
            "0300 1234567",
            "0300-1234567",
            "+92 300 1234567",
            "0092 300 1234567",
            "923001234567",
            "300 1234567",
            "3001234567"
          ] do
        assert Phone.normalize(typed) == {:ok, "+923001234567"}
      end

      assert Phone.normalize("+44 7700 900123") == {:ok, "+447700900123"}
      assert Phone.normalize("12") == {:error, :bad_phone}
      assert Phone.normalize("not a number") == {:error, :bad_phone}
    end
  end

  describe "signing in by phone" do
    test "a code signs in, makes the account once, and works only once" do
      body = send_code("0300 1112233") |> json_response(200)
      assert body == %{"phone" => "+923001112233", "resend_after" => 30}
      code = code_for("03001112233")
      assert code =~ ~r/^\d{6}$/

      first = phone_sign_in("+92 300 1112233", code) |> json_response(200)

      assert %{"new_account" => true, "device_id" => 1, "user" => %{"phone" => "+923001112233"}} =
               first

      assert first["user"]["email"] == nil
      assert first["user"]["name"] == "PakChat 2233"

      # Used once: the same code doesn't work again.
      assert phone_sign_in("03001112233", code) |> json_response(422) == %{
               "error" => "wrong_code"
             }

      age_codes()
      send_code("03001112233")
      again = phone_sign_in("03001112233") |> json_response(200)
      assert again["new_account"] == false
      assert again["user"]["id"] == first["user"]["id"]
      # The new phone took over: the first one is signed out.
      assert as(%{token: first["token"]}) |> get(~p"/api/me") |> json_response(401)
    end

    test "a wrong code is refused, and after 5 tries even the right one is" do
      send_code("03002223344")
      real = code_for("03002223344")
      wrong = if real == "000000", do: "111111", else: "000000"

      for _ <- 1..5 do
        assert phone_sign_in("03002223344", wrong) |> json_response(422) == %{
                 "error" => "wrong_code"
               }
      end

      assert phone_sign_in("03002223344", real) |> json_response(422) == %{
               "error" => "too_many_tries"
             }
    end

    test "limits: one code per 30 seconds, 5 a day per number, and the daily cap" do
      assert send_code("03003334455").status == 200
      assert send_code("03003334455") |> json_response(422) == %{"error" => "wait"}

      for _ <- 1..4 do
        age_codes()
        assert send_code("03003334455").status == 200
      end

      age_codes()
      assert send_code("03003334455") |> json_response(422) == %{"error" => "too_many_codes"}

      Application.put_env(:pakchat, :sms_daily_cap, 5)
      on_exit(fn -> Application.delete_env(:pakchat, :sms_daily_cap) end)
      assert send_code("03009998877") |> json_response(422) == %{"error" => "sms_cap"}
    end

    test "a made-up number is refused before anything is sent" do
      assert send_code("123") |> json_response(422) == %{"error" => "bad_phone"}
    end

    test "the code-reading address only works with test sign-in on" do
      send_code("03004445566")
      assert build_conn() |> get(~p"/api/auth/test/code?phone=03004445566") |> json_response(200)
      Application.put_env(:pakchat, :test_sign_in, false)
      assert build_conn() |> get(~p"/api/auth/test/code?phone=03004445566") |> json_response(404)
    end
  end

  describe "one account, Gmail and number" do
    test "a Google account adds a number, then signs in by either" do
      ali = person("Ali")

      body =
        as(ali) |> post(~p"/api/me/phone/code", %{"phone" => "03005556677"}) |> json_response(200)

      assert body["phone"] == "+923005556677"

      me =
        as(ali)
        |> put(~p"/api/me/phone", %{"phone" => "0300 5556677", "code" => code_for("03005556677")})
        |> json_response(200)

      assert me["phone"] == "+923005556677"
      assert me["email"] == ali.user.email

      age_codes()
      send_code("03005556677")
      by_phone = phone_sign_in("03005556677") |> json_response(200)
      assert by_phone["user"]["id"] == ali.user.id
      assert by_phone["new_account"] == false
    end

    test "a phone account adds a Gmail, and Google sign-in finds the same account" do
      send_code("03006667788")
      sara = phone_sign_in("03006667788") |> json_response(200)
      sara_conn = fn -> as(%{token: sara["token"]}) end
      token = google_token("Sara", %{"sub" => "sara-google", "email" => "sara.k@gmail.com"})

      me = sara_conn.() |> put(~p"/api/me/google", %{"id_token" => token}) |> json_response(200)
      assert me["email"] == "sara.k@gmail.com"

      {:ok, attrs} = PakchatWeb.Params.device(device_params())
      {:ok, %{user: user}} = Accounts.sign_in_with_google(token, attrs)
      assert user.id == sara["user"]["id"]
    end

    test "someone else's number or Gmail can't be added (joining accounts comes later)" do
      ali = person("Ali")
      send_code("03007778899")
      phone_sign_in("03007778899") |> json_response(200)

      assert as(ali)
             |> post(~p"/api/me/phone/code", %{"phone" => "03007778899"})
             |> json_response(422) ==
               %{"error" => "taken"}

      bilal = person("Bilal")

      token =
        google_token("Bilal", %{"sub" => bilal.user.google_sub, "email" => bilal.user.email})

      assert as(ali) |> put(~p"/api/me/google", %{"id_token" => token}) |> json_response(422) ==
               %{"error" => "taken"}
    end

    test "unlinking is allowed only while another way to sign in stays" do
      ali = person("Ali")

      assert as(ali) |> delete(~p"/api/me/google") |> json_response(422) == %{
               "error" => "last_sign_in"
             }

      as(ali) |> post(~p"/api/me/phone/code", %{"phone" => "03008889900"})

      as(ali)
      |> put(~p"/api/me/phone", %{"phone" => "03008889900", "code" => code_for("03008889900")})

      me = as(ali) |> delete(~p"/api/me/google") |> json_response(200)
      assert me["email"] == nil
      assert me["phone"] == "+923008889900"

      assert as(ali) |> delete(~p"/api/me/phone") |> json_response(422) == %{
               "error" => "last_sign_in"
             }
    end
  end

  describe "finding people" do
    test "by phone number, typed any way, without showing it back" do
      ali = person("Ali")
      send_code("03001231234")
      sara = phone_sign_in("03001231234") |> json_response(200)

      body = as(ali) |> get(~p"/api/users/lookup?phone=0300-123 1234") |> json_response(200)
      assert body["id"] == sara["user"]["id"]
      refute Map.has_key?(body, "phone")
      assert as(ali) |> get(~p"/api/users/lookup?phone=03000000000") |> json_response(404)
    end

    test "whoever starts a chat shows their number and Gmail to the other person, not the other way" do
      ali = person("Ali")
      send_code("03001239876")
      sara = phone_sign_in("03001239876") |> json_response(200)
      sara = %{token: sara["token"], id: sara["user"]["id"]}

      # Before any chat, nobody sees anything.
      refute as(ali)
             |> get(~p"/api/users/#{sara.id}")
             |> json_response(200)
             |> Map.has_key?("phone")

      # Sara messages Ali first: Ali can see her number (to add her), she can't see his Gmail.
      as(sara) |> post(~p"/api/chats/direct", %{"user_id" => ali.user.id}) |> json_response(200)
      seen = as(ali) |> get(~p"/api/users/#{sara.id}") |> json_response(200)
      assert seen["phone"] == "+923001239876"
      assert Map.has_key?(seen, "email")
      back = as(sara) |> get(~p"/api/users/#{ali.user.id}") |> json_response(200)
      refute Map.has_key?(back, "email")
      refute Map.has_key?(back, "phone")
    end

    test "once the other person writes back, the one who started sees how to reach them too" do
      ali = person("Ali")
      sara = person("Sara")
      {:ok, chat} = Chats.get_or_create_direct(ali.user, sara.user.id)

      sealed = fn to ->
        %{user_id: to.user.id, device_id: to.device.device_id, type: 2, body: "eA=="}
      end

      ways? = fn viewer, of ->
        as(viewer)
        |> get(~p"/api/users/#{of.user.id}")
        |> json_response(200)
        |> Map.has_key?("email")
      end

      # Ali started it: Sara sees his, he doesn't see hers, even after he writes again.
      {:ok, _} = Relay.send_message(ali.device, chat.id, %{envelopes: [sealed.(sara)]})
      assert ways?.(sara, ali)
      refute ways?.(ali, sara)

      # Sara answers: now Ali sees hers.
      {:ok, _} = Relay.send_message(sara.device, chat.id, %{envelopes: [sealed.(ali)]})
      assert ways?.(ali, sara)
    end

    test "from the phone's contacts, by hashes only, and one person shows once per hash" do
      ali = person("Ali")
      sara = person("Sara")
      send_code("03004564567")
      bilal = phone_sign_in("03004564567") |> json_response(200)

      h = fn text -> Base.encode64(:crypto.hash(:sha256, text)) end

      found =
        as(ali)
        |> post(~p"/api/contacts/match", %{
          "phones" => [h.("+923004564567"), h.("+923000000000"), "not base64!"],
          "emails" => [
            h.(String.upcase(sara.user.email) |> String.downcase()),
            h.(ali.user.email)
          ]
        })
        |> json_response(200)

      ids = found |> Enum.map(& &1["user"]["id"]) |> Enum.sort()
      # Not Ali himself, and not numbers that aren't on PakChat.
      assert ids == Enum.sort([bilal["user"]["id"], sara.user.id])
    end

    test "too many hashes at once are refused" do
      ali = person("Ali")
      many = for i <- 1..2001, do: Base.encode64(:crypto.hash(:sha256, "#{i}"))
      assert as(ali) |> post(~p"/api/contacts/match", %{"phones" => many}) |> json_response(422)
    end
  end

  describe "files" do
    setup do
      ali = person("Ali")
      sara = person("Sara")
      bilal = person("Bilal")
      {:ok, chat} = Pakchat.Chats.get_or_create_direct(ali.user, sara.user.id)
      %{ali: ali, sara: sara, bilal: bilal, chat: chat}
    end

    defp upload(url, bytes) do
      build_conn()
      |> put_req_header("content-type", "application/octet-stream")
      |> put(url, bytes)
    end

    test "sent in a chat, only its members can download it", %{
      ali: ali,
      sara: sara,
      bilal: bilal,
      chat: chat
    } do
      bytes = :crypto.strong_rand_bytes(300_000)

      %{"id" => id, "upload_url" => url} =
        as(ali)
        |> post(~p"/api/files", %{"chat_id" => chat.id, "size" => 300_000})
        |> json_response(200)

      # Not uploaded yet: no link.
      assert as(sara) |> get(~p"/api/files/#{id}/link") |> json_response(404)
      assert upload(url, bytes).status == 204
      # Once is enough.
      assert upload(url, bytes) |> json_response(422)

      %{"url" => link} = as(sara) |> get(~p"/api/files/#{id}/link") |> json_response(200)
      assert build_conn() |> get(link) |> response(200) == bytes
      assert as(bilal) |> get(~p"/api/files/#{id}/link") |> json_response(404)

      # A made-up or changed link doesn't work.
      assert build_conn() |> get(~p"/api/files/#{id}/data?t=nope") |> json_response(403)
      [_, token] = String.split(url, "t=")
      assert build_conn() |> get(~p"/api/files/#{id}/data?t=#{token}") |> json_response(403)
    end

    test "the size must match what was asked, and stay under the limit", %{ali: ali, chat: chat} do
      %{"max_bytes" => max} = as(ali) |> get(~p"/api/files/limits") |> json_response(200)
      assert max == 1024 * 1024

      assert as(ali)
             |> post(~p"/api/files", %{"chat_id" => chat.id, "size" => max + 1000})
             |> json_response(422) ==
               %{"error" => "too_big"}

      %{"upload_url" => url} =
        as(ali)
        |> post(~p"/api/files", %{"chat_id" => chat.id, "size" => 10})
        |> json_response(200)

      assert upload(url, "only nine") |> json_response(422)
      assert upload(url, "eleven byte") |> json_response(422)
    end

    test "refused while the disk is nearly full, so messages keep working", %{
      ali: ali,
      chat: chat
    } do
      Application.put_env(:pakchat, :min_free_mb, 1_000_000_000)
      on_exit(fn -> Application.delete_env(:pakchat, :min_free_mb) end)

      assert as(ali)
             |> post(~p"/api/files", %{"chat_id" => chat.id, "size" => 10})
             |> json_response(507) == %{"error" => "storage_full"}
    end

    test "only into my own chats", %{bilal: bilal, chat: chat} do
      assert as(bilal)
             |> post(~p"/api/files", %{"chat_id" => chat.id, "size" => 10})
             |> json_response(404)

      assert as(bilal)
             |> post(~p"/api/files", %{"chat_id" => "not-a-chat", "size" => 10})
             |> json_response(404)
    end

    test "old ones are deleted, bytes and all", %{ali: ali, chat: chat} do
      %{"id" => id, "upload_url" => url} =
        as(ali)
        |> post(~p"/api/files", %{"chat_id" => chat.id, "size" => 3})
        |> json_response(200)

      upload(url, "abc")
      assert File.exists?(Files.path(id))

      Pakchat.Repo.update_all(Pakchat.Files.File,
        set: [expires_at: DateTime.add(DateTime.utc_now(), -1, :second)]
      )

      assert Files.delete_expired() == 1
      refute File.exists?(Files.path(id))
    end
  end

  describe "backups" do
    test "one per person, replaced by the next, readable only by its owner" do
      ali = person("Ali")
      sara = person("Sara")
      assert as(ali) |> get(~p"/api/backup") |> json_response(404)

      %{"upload_url" => url1} =
        as(ali) |> post(~p"/api/backup", %{"size" => 5}) |> json_response(200)

      assert upload(url1, "first").status == 204
      %{"url" => link1, "size" => 5} = as(ali) |> get(~p"/api/backup") |> json_response(200)
      assert build_conn() |> get(link1) |> response(200) == "first"

      %{"upload_url" => url2} =
        as(ali) |> post(~p"/api/backup", %{"size" => 6}) |> json_response(200)

      assert upload(url2, "second").status == 204
      %{"url" => link2} = as(ali) |> get(~p"/api/backup") |> json_response(200)
      assert build_conn() |> get(link2) |> response(200) == "second"
      # The first one is gone.
      assert build_conn() |> get(link1) |> json_response(404)

      assert as(sara) |> get(~p"/api/backup") |> json_response(404)
      assert as(ali) |> delete(~p"/api/backup") |> response(204)
      assert as(ali) |> get(~p"/api/backup") |> json_response(404)
    end
  end
end
