defmodule PakchatWeb.LinkingTest do
  @moduledoc "Linking a website to a phone by QR code, and seeing and removing linked devices."
  use PakchatWeb.ConnCase, async: true
  import Phoenix.ChannelTest, except: [connect: 2]
  import Pakchat.Fixtures
  alias Pakchat.Linking

  defp as(%{token: token}),
    do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  defp website(name \\ "Chrome on Mac") do
    build_conn()
    |> post(~p"/api/link", %{
      "device" => device_params(name),
      "pre_keys" => pre_keys(1, 5),
      "kyber_pre_keys" => kyber_pre_keys(1, 5)
    })
    |> json_response(200)
  end

  defp wait(%{"id" => id, "secret" => secret}) do
    {:ok, socket} =
      Phoenix.ChannelTest.connect(PakchatWeb.LinkSocket, %{"id" => id, "secret" => secret})

    {:ok, reply, socket} = subscribe_and_join(socket, "link:" <> id, %{})
    {reply, socket}
  end

  defp provision, do: Base.encode64(:crypto.strong_rand_bytes(200))

  setup do
    %{ali: person("Ali"), sara: person("Sara")}
  end

  test "the phone approves a QR and the website is signed in", %{ali: ali} do
    w = website()
    assert %{"code" => code, "expires_in" => 60} = w
    {%{}, _socket} = wait(w)

    # The phone sees which website it is, to check against the QR.
    shown = as(ali) |> get(~p"/api/link/#{code}") |> json_response(200)
    assert shown["name"] == "Chrome on Mac"
    assert {:ok, <<_::binary-size(33)>>} = Base.decode64(shown["identity_key"])

    p = provision()

    assert %{"device_id" => 2, "device_uuid" => uuid} =
             as(ali) |> post(~p"/api/link/#{code}", %{"provision" => p}) |> json_response(200)

    assert_push "linked", %{
      token: token,
      device_id: 2,
      device_uuid: ^uuid,
      provision: ^p,
      user: user
    }

    assert user.id == ali.user.id

    # The website's token works, and its one-time keys are there for others.
    me = as(%{token: token}) |> get(~p"/api/me") |> json_response(200)
    assert me["id"] == ali.user.id
    assert %{ec: 5, kyber: 5} = Pakchat.Keys.counts(Pakchat.Accounts.get_device(uuid))

    # The code can't be used twice.
    assert as(ali) |> post(~p"/api/link/#{code}", %{"provision" => p}) |> json_response(404)
    assert as(ali) |> get(~p"/api/link/#{code}") |> json_response(404)

    # The phone lists its devices.
    devices = as(ali) |> get(~p"/api/me/devices") |> json_response(200)

    assert [%{"device_id" => 1}, %{"device_id" => 2, "name" => "Chrome on Mac"} = laptop] =
             devices

    # Not connected yet: not online, and never active.
    assert %{"online" => false, "last_active" => nil} = laptop
  end

  test "a website that reconnects after the phone said yes still gets its token", %{ali: ali} do
    w = website()

    as(ali)
    |> post(~p"/api/link/#{w["code"]}", %{"provision" => provision()})
    |> json_response(200)

    assert {%{linked: %{token: _, device_id: 2}}, socket} = wait(w)

    # Once it says it has it, the request is gone.
    ref = Phoenix.ChannelTest.push(socket, "done", %{})
    assert_reply ref, :ok
    assert {:error, :not_found} = Linking.check(w["id"], w["secret"])
  end

  test "codes change, and run out after six", %{ali: ali} do
    w = website()

    codes =
      for _ <- 2..6 do
        r =
          build_conn()
          |> post(~p"/api/link/#{w["id"]}/code", %{"secret" => w["secret"]})
          |> json_response(200)

        assert r["expires_in"] == 20
        r["code"]
      end

    assert length(Enum.uniq([w["code"] | codes])) == 6

    assert %{"error" => "expired"} =
             build_conn()
             |> post(~p"/api/link/#{w["id"]}/code", %{"secret" => w["secret"]})
             |> json_response(422)

    # Old codes stop working; the newest still does.
    assert as(ali) |> get(~p"/api/link/#{w["code"]}") |> json_response(404)
    assert as(ali) |> get(~p"/api/link/#{List.last(codes)}") |> json_response(200)
  end

  test "a wrong secret gets nothing" do
    w = website()

    assert build_conn()
           |> post(~p"/api/link/#{w["id"]}/code", %{"secret" => "wrong"})
           |> json_response(404)

    assert :error =
             Phoenix.ChannelTest.connect(PakchatWeb.LinkSocket, %{
               "id" => w["id"],
               "secret" => "wrong"
             })
  end

  test "only the main phone can link or remove devices", %{ali: ali} do
    laptop = linked(ali.user)
    w = website()
    assert as(laptop) |> get(~p"/api/link/#{w["code"]}") |> json_response(403)

    assert as(laptop)
           |> post(~p"/api/link/#{w["code"]}", %{"provision" => provision()})
           |> json_response(403)

    assert as(laptop) |> delete(~p"/api/me/devices/2") |> json_response(403)
    # The code wasn't used up by trying.
    assert as(ali) |> get(~p"/api/link/#{w["code"]}") |> json_response(200)
  end

  test "up to four linked devices", %{ali: ali} do
    for _ <- 1..4, do: linked(ali.user)
    w = website()

    assert %{"error" => "too_many_devices"} =
             as(ali)
             |> post(~p"/api/link/#{w["code"]}", %{"provision" => provision()})
             |> json_response(422)

    # After removing one, the same QR still works.
    assert as(ali) |> delete(~p"/api/me/devices/3") |> response(204)

    assert %{"device_id" => 3} =
             as(ali)
             |> post(~p"/api/link/#{w["code"]}", %{"provision" => provision()})
             |> json_response(200)
  end

  test "removing a linked device signs it out, and the phone can't remove itself", %{ali: ali} do
    laptop = linked(ali.user)
    assert as(ali) |> delete(~p"/api/me/devices/#{laptop.device.device_id}") |> response(204)
    assert as(laptop) |> get(~p"/api/me") |> json_response(401)
    assert as(ali) |> delete(~p"/api/me/devices/1") |> json_response(404)
    assert as(ali) |> get(~p"/api/me") |> json_response(200)
  end

  test "someone else's device can't be removed", %{ali: ali, sara: sara} do
    laptop = linked(sara.user)
    assert as(ali) |> delete(~p"/api/me/devices/#{laptop.device.device_id}") |> json_response(404)
    assert as(laptop) |> get(~p"/api/me") |> json_response(200)
  end

  test "bad keys are refused before showing a QR" do
    bad = Map.put(device_params(), "identity_key", b64(10))

    assert build_conn()
           |> post(~p"/api/link", %{"device" => bad, "pre_keys" => [], "kyber_pre_keys" => []})
           |> json_response(422)

    assert build_conn()
           |> post(~p"/api/link", %{
             "device" => device_params(),
             "pre_keys" => pre_keys(1, 101),
             "kyber_pre_keys" => []
           })
           |> json_response(422)

    assert build_conn() |> post(~p"/api/link", %{}) |> json_response(400)
  end

  test "a website with no name is called Browser", %{ali: ali} do
    w =
      build_conn()
      |> post(~p"/api/link", %{
        "device" => Map.delete(device_params(), "name"),
        "pre_keys" => [],
        "kyber_pre_keys" => []
      })
      |> json_response(200)

    assert %{"name" => "Browser"} =
             as(ali) |> get(~p"/api/link/#{w["code"]}") |> json_response(200)
  end

  test "old requests are swept away" do
    w = website()
    [{key, request}] = :ets.lookup(Linking, {:id, w["id"]})
    past = System.monotonic_time(:millisecond) - 1
    :ets.insert(Linking, {key, %{request | code_expires: past, ends: past}})
    Linking.sweep()
    assert {:error, :not_found} = Linking.check(w["id"], w["secret"])
    assert :ets.lookup(Linking, {:code, w["code"]}) == []
  end

  describe "linking with a phone number instead" do
    defp sealed, do: Base.encode64(:crypto.strong_rand_bytes(120))

    defp with_phone(%{user: user} = who, phone) do
      %{who | user: user |> Ecto.Changeset.change(phone: phone) |> Pakchat.Repo.update!()}
    end

    test "the website seals its QR for a number, and only that number's phone sees it", %{
      ali: ali,
      sara: sara
    } do
      ali = with_phone(ali, "+923001234567")
      sara = with_phone(sara, "+923007654321")
      w = website()
      s1 = sealed()

      # The number as typed comes back tidied, for the website's sealing.
      assert %{"phone" => "+923001234567"} =
               build_conn()
               |> post(~p"/api/link/#{w["id"]}/phone", %{
                 "secret" => w["secret"],
                 "phone" => "0300 1234567"
               })
               |> json_response(200)

      # Nothing sealed yet: nothing to show.
      assert %{"phone" => "+923001234567", "waiting" => []} =
               as(ali) |> get(~p"/api/me/pairing") |> json_response(200)

      build_conn()
      |> post(~p"/api/link/#{w["id"]}/phone", %{
        "secret" => w["secret"],
        "phone" => "+923001234567",
        "sealed" => s1
      })
      |> json_response(200)

      assert %{"waiting" => [%{"sealed" => ^s1, "name" => "Chrome on Mac"}]} =
               as(ali) |> get(~p"/api/me/pairing") |> json_response(200)

      assert %{"waiting" => []} = as(sara) |> get(~p"/api/me/pairing") |> json_response(200)

      # With each new code it's sealed again: the phone sees the newest.
      %{"code" => code} =
        build_conn()
        |> post(~p"/api/link/#{w["id"]}/code", %{"secret" => w["secret"]})
        |> json_response(200)

      s2 = sealed()

      build_conn()
      |> post(~p"/api/link/#{w["id"]}/phone", %{
        "secret" => w["secret"],
        "phone" => "+923001234567",
        "sealed" => s2
      })
      |> json_response(200)

      assert %{"waiting" => [%{"sealed" => ^s2}]} =
               as(ali) |> get(~p"/api/me/pairing") |> json_response(200)

      # The phone opens it and approves the code inside, as with a QR. Then it's gone.
      {%{}, _socket} = wait(w)

      as(ali)
      |> post(~p"/api/link/#{code}", %{"provision" => provision()})
      |> json_response(200)

      assert_push "linked", %{device_id: 2}
      assert %{"waiting" => []} = as(ali) |> get(~p"/api/me/pairing") |> json_response(200)
    end

    test "a wrong secret, a bad number or a bad seal is refused, and a linked device can't look",
         %{ali: ali} do
      ali = with_phone(ali, "+923001234567")
      w = website()

      assert build_conn()
             |> post(~p"/api/link/#{w["id"]}/phone", %{
               "secret" => "nope",
               "phone" => "+923001234567"
             })
             |> json_response(404)

      assert build_conn()
             |> post(~p"/api/link/#{w["id"]}/phone", %{"secret" => w["secret"], "phone" => "12"})
             |> json_response(422)

      for bad <- ["not base64!", Base.encode64("short"), String.duplicate("A", 2000), 5] do
        assert build_conn()
               |> post(~p"/api/link/#{w["id"]}/phone", %{
                 "secret" => w["secret"],
                 "phone" => "+923001234567",
                 "sealed" => bad
               })
               |> json_response(400)
      end

      assert as(linked(ali.user)) |> get(~p"/api/me/pairing") |> json_response(403)
    end

    test "someone signed in with Gmail only has nothing waiting", %{sara: sara} do
      assert %{"phone" => nil, "waiting" => []} =
               as(sara) |> get(~p"/api/me/pairing") |> json_response(200)
    end
  end
end
