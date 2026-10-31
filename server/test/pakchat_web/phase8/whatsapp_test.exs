defmodule PakchatWeb.WhatsAppTest do
  @moduledoc """
  Checking a phone number with WhatsApp: the app starts a check, the person
  sends the code to PakChat's number, Meta tells the server (a pretend Meta
  here, signing its messages like the real one), and the app signs in or adds
  the number with the secret it was given.
  """
  # Not async: it changes the WhatsApp settings.
  use PakchatWeb.ConnCase, async: false
  import Pakchat.Fixtures
  alias Pakchat.Repo
  alias Pakchat.WhatsApp.Check

  @secret "meta-app-secret"
  @settings [
    number: "923000000000",
    app_secret: @secret,
    verify_token: "made-up-word",
    token: "meta-token",
    phone_number_id: "99"
  ]

  setup do
    Application.put_env(:pakchat, :whatsapp, @settings)
    test = self()

    Application.put_env(:pakchat, :whatsapp_send, fn to, text ->
      send(test, {:replied, to, text})
    end)

    on_exit(fn ->
      Application.delete_env(:pakchat, :whatsapp)
      Application.delete_env(:pakchat, :whatsapp_send)
    end)

    :ok
  end

  defp start(purpose \\ "sign_in"),
    do:
      build_conn() |> post(~p"/api/auth/whatsapp", %{"purpose" => purpose}) |> json_response(200)

  defp claim(%{"id" => id, "secret" => secret}),
    do: build_conn() |> post(~p"/api/auth/whatsapp/#{id}", %{"secret" => secret})

  # What Meta sends when someone messages PakChat's number.
  defp meta_message(from, text) do
    %{
      "object" => "whatsapp_business_account",
      "entry" => [
        %{
          "id" => "1",
          "changes" => [
            %{
              "field" => "messages",
              "value" => %{
                "messaging_product" => "whatsapp",
                "metadata" => %{
                  "display_phone_number" => "923000000000",
                  "phone_number_id" => "99"
                },
                "contacts" => [%{"profile" => %{"name" => "Ali"}, "wa_id" => from}],
                "messages" => [
                  %{
                    "from" => from,
                    "id" => "wamid.1",
                    "timestamp" => "1",
                    "type" => "text",
                    "text" => %{"body" => text}
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  end

  defp deliver(payload, secret \\ @secret) do
    body = Jason.encode!(payload)

    signature =
      "sha256=" <> (:crypto.mac(:hmac, :sha256, secret, body) |> Base.encode16(case: :lower))

    build_conn()
    |> put_req_header("content-type", "application/json")
    |> put_req_header("x-hub-signature-256", signature)
    |> post(~p"/api/whatsapp/webhook", body)
  end

  defp sign_in(phone, code) do
    build_conn()
    |> post(~p"/api/auth/phone", %{
      "phone" => phone,
      "code" => code,
      "device" => device_params(),
      "pre_keys" => pre_keys(1, 3),
      "kyber_pre_keys" => kyber_pre_keys(1, 3)
    })
  end

  test "is off until its settings are there" do
    Application.delete_env(:pakchat, :whatsapp)
    assert build_conn() |> get(~p"/api/auth/whatsapp") |> json_response(404)
    assert build_conn() |> post(~p"/api/auth/whatsapp", %{}) |> json_response(404)

    Application.put_env(:pakchat, :whatsapp, @settings)
    assert %{"on" => true} = build_conn() |> get(~p"/api/auth/whatsapp") |> json_response(200)
  end

  test "signs in the number that sent the code" do
    check = start()
    assert %{"code" => code, "text" => "PakChat code: " <> code, "url" => url} = check

    assert url ==
             "https://wa.me/923000000000?text=" <> URI.encode_www_form("PakChat code: " <> code)

    assert %{"status" => "waiting"} = claim(check) |> json_response(200)

    # The person presses Send in WhatsApp (and may type around the code).
    assert deliver(
             meta_message("923001234567", "hi PakChat code: #{String.downcase(code)} thanks")
           )
           |> response(200)

    assert_receive {:replied, "923001234567", "✅ Done!" <> _}

    assert %{"status" => "done", "phone" => "+923001234567"} = claim(check) |> json_response(200)
    # Asked once more, it's gone: the secret can't be claimed twice.
    assert claim(check) |> json_response(404)

    assert %{"user" => %{"phone" => "+923001234567"}, "new_account" => true} =
             sign_in("+923001234567", check["secret"]) |> json_response(200)

    # The secret is a one-time code.
    assert sign_in("+923001234567", check["secret"]) |> json_response(422)
  end

  test "the secret only signs in the number that sent the code" do
    check = start()
    deliver(meta_message("923001234567", "PakChat code: " <> check["code"]))
    assert %{"status" => "done"} = claim(check) |> json_response(200)

    assert sign_in("+923009999999", check["secret"]) |> json_response(422)
  end

  test "adds a number to an account that signed in with Google" do
    ali = person("Ali")
    check = start("link")
    deliver(meta_message("923001234567", "PakChat code: " <> check["code"]))
    assert %{"status" => "done", "phone" => phone} = claim(check) |> json_response(200)

    assert %{"phone" => "+923001234567"} =
             build_conn()
             |> put_req_header("authorization", "Bearer " <> ali.token)
             |> put(~p"/api/me/phone", %{"phone" => phone, "code" => check["secret"]})
             |> json_response(200)
  end

  test "a wrong secret or a made-up id gets nothing" do
    check = start()
    deliver(meta_message("923001234567", "PakChat code: " <> check["code"]))

    assert claim(%{check | "secret" => "guess"}) |> json_response(404)
    assert claim(%{check | "id" => Ecto.UUID.generate()}) |> json_response(404)
    assert claim(%{check | "id" => "nonsense"}) |> json_response(404)
  end

  test "messages without Meta's signature are refused" do
    check = start()

    assert deliver(
             meta_message("923001234567", "PakChat code: " <> check["code"]),
             "not-the-secret"
           )
           |> response(401)

    assert build_conn()
           |> put_req_header("content-type", "application/json")
           |> post(
             ~p"/api/whatsapp/webhook",
             Jason.encode!(meta_message("923001234567", check["code"]))
           )
           |> response(401)

    assert %{"status" => "waiting"} = claim(check) |> json_response(200)
  end

  test "a code that ran out doesn't count" do
    check = start()
    Repo.update_all(Check, set: [expires_at: DateTime.add(DateTime.utc_now(), -1, :second)])

    deliver(meta_message("923001234567", "PakChat code: " <> check["code"]))
    assert_receive {:replied, _, "⌛" <> _}
    assert claim(check) |> json_response(422)
  end

  test "a wrong code gets a hint, and other chats to the number get no answer" do
    deliver(meta_message("923001234567", "PakChat code: ZZZZZZ"))
    assert_receive {:replied, "923001234567", "That code didn't work." <> _}

    deliver(meta_message("923001234567", "hello, is this a shop?"))
    refute_receive {:replied, _, _}, 100
  end

  test "Meta's check of the webhook address needs our made-up word" do
    ok = %{
      "hub.mode" => "subscribe",
      "hub.verify_token" => "made-up-word",
      "hub.challenge" => "12345"
    }

    assert build_conn() |> get(~p"/api/whatsapp/webhook", ok) |> response(200) == "12345"

    wrong = %{ok | "hub.verify_token" => "guess"}
    assert build_conn() |> get(~p"/api/whatsapp/webhook", wrong) |> response(403)
  end

  test "delivery reports and other things Meta sends are fine" do
    report = %{
      "entry" => [
        %{
          "changes" => [%{"value" => %{"statuses" => [%{"id" => "wamid.1", "status" => "read"}]}}]
        }
      ]
    }

    assert deliver(report) |> response(200)
    refute_receive {:replied, _, _}, 100
  end
end
