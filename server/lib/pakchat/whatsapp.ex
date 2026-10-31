defmodule Pakchat.WhatsApp do
  @moduledoc """
  Checking a phone number with WhatsApp, free for everyone.

  Instead of us sending a code (an SMS costs money), the person sends one to us:

    1. The app asks for a check (`start/1`). We make a short code like
       `K7M4QX` and a secret that only that app knows.
    2. The app opens WhatsApp with "PakChat code: K7M4QX" ready to send to
       PakChat's own WhatsApp Business number. The person presses Send.
    3. Meta tells our server about the message (`received/2`, from the webhook
       in PakchatWeb.WhatsAppController). WhatsApp has already proved which
       number sent it, so that number is now checked.
    4. The app, which keeps asking (`claim/2`), gets the number and a one-time
       sign-in code for it. It then signs in (or adds the number) exactly as
       with an SMS code (Pakchat.PhoneCodes).

  Messages people send to a business, and our replies within 24 hours, cost
  nothing. Settings (server `.env`, never in git):

    * `WHATSAPP_NUMBER`: PakChat's WhatsApp number, digits only (`923001234567`).
    * `WHATSAPP_APP_SECRET`: the Meta app's secret, to know the messages really come from Meta.
    * `WHATSAPP_VERIFY_TOKEN`: any long word we make up, typed into Meta's webhook page too.
    * `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` (optional): to send "Done, go
      back to PakChat" back. Without them it still works, just without the reply.

  It's switched on when the first three are set.
  """
  import Ecto.Query
  require Logger
  alias Pakchat.{Phone, PhoneCodes, Repo}
  alias Pakchat.WhatsApp.Check

  @lasts_minutes 10
  # No 0/O, 1/I/L, so a code read aloud or retyped can't go wrong.
  @alphabet ~c"ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  @purposes ["sign_in", "link"]

  @doc "Whether WhatsApp checks are switched on."
  def on?, do: Enum.all?([number(), app_secret(), verify_token()], &(is_binary(&1) and &1 != ""))

  @doc """
  Starts a check. Answers the check's id, the secret the app keeps, the code,
  and the WhatsApp link that opens a chat with the message ready.
  """
  def start(purpose) when purpose in @purposes do
    if on?() do
      code = free_code()
      secret = Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)
      text = "PakChat code: #{code}"

      check =
        Repo.insert!(%Check{
          code: code,
          secret_hash: hash(secret),
          purpose: purpose,
          expires_at: DateTime.add(DateTime.utc_now(), @lasts_minutes, :minute)
        })

      {:ok,
       %{
         id: check.id,
         secret: secret,
         code: code,
         text: text,
         url: "https://wa.me/#{number()}?text=#{URI.encode_www_form(text)}",
         expires_in: @lasts_minutes * 60
       }}
    else
      {:error, :not_found}
    end
  end

  def start(_), do: {:error, :bad_request}

  @doc """
  A WhatsApp message reached PakChat's number. `from` is the sender's number
  as WhatsApp gives it (digits, with the country code). Answers `:checked`,
  `:no_code` or `:expired`.
  """
  def received(from, body) when is_binary(from) and is_binary(body) do
    now = DateTime.utc_now()
    codes = codes_in(body)

    with {:ok, phone} <- Phone.normalize("+" <> from),
         [_ | _] <- codes,
         %Check{} = check <-
           Repo.one(
             from c in Check,
               where: c.code in ^codes and is_nil(c.phone),
               order_by: [desc: c.inserted_at],
               limit: 1
           ) do
      if DateTime.compare(check.expires_at, now) == :gt do
        check |> Ecto.Changeset.change(phone: phone) |> Repo.update!()
        :checked
      else
        :expired
      end
    else
      _ -> :no_code
    end
  end

  def received(_, _), do: :no_code

  @doc """
  The app asking "has my code arrived?". Answers `{:ok, :waiting}`, or, once the
  number has sent the code, `{:ok, phone}`: the secret is then also a one-time
  sign-in code for that number (Pakchat.PhoneCodes), and the check is gone.
  """
  def claim(id, secret) when is_binary(id) and is_binary(secret) do
    now = DateTime.utc_now()

    with {:ok, id} <- Ecto.UUID.cast(id),
         %Check{} = check <- Repo.get(Check, id),
         true <- Plug.Crypto.secure_compare(check.secret_hash, hash(secret)) do
      cond do
        check.phone != nil ->
          Repo.delete!(check)
          PhoneCodes.allow(check.phone, check.purpose, secret)
          {:ok, check.phone}

        DateTime.compare(check.expires_at, now) == :gt ->
          {:ok, :waiting}

        true ->
          {:error, :expired}
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def claim(_, _), do: {:error, :not_found}

  @doc "Deletes checks older than a day."
  def delete_old do
    day_ago = DateTime.add(DateTime.utc_now(), -1, :day)
    {count, _} = Repo.delete_all(from c in Check, where: c.inserted_at < ^day_ago)
    count
  end

  ## Meta's webhook

  @doc "Meta's one-time check of our webhook address: our made-up word must match."
  def verify_token?(token),
    do: on?() and is_binary(token) and Plug.Crypto.secure_compare(token, verify_token())

  @doc """
  Whether a webhook message really comes from Meta: Meta signs the exact bytes
  it sends with our app's secret (header `X-Hub-Signature-256: sha256=<hex>`).
  """
  def signed?(raw_body, "sha256=" <> hex) when is_binary(raw_body) do
    secret = app_secret()

    if is_binary(secret) and secret != "" do
      ours = :crypto.mac(:hmac, :sha256, secret, raw_body) |> Base.encode16(case: :lower)
      Plug.Crypto.secure_compare(ours, String.downcase(hex))
    else
      false
    end
  end

  def signed?(_, _), do: false

  @doc "Handles everything in one webhook delivery from Meta (it may hold several messages)."
  def handle_webhook(%{"entry" => entries}) when is_list(entries) do
    for %{"changes" => changes} <- entries,
        is_list(changes),
        %{"value" => %{"messages" => messages}} <- changes,
        is_list(messages),
        %{"from" => from, "type" => "text", "text" => %{"body" => body}} <- messages do
      result = received(from, body)
      Logger.info("whatsapp: a code from ...#{String.slice(from, -4, 4)}: #{result}")
      answer(from, body, result)
      result
    end
  end

  def handle_webhook(_), do: []

  # Tells the person how it went, when we can send messages back. Replies inside
  # the 24 hours after their message are free. Random chats to the number get no answer.
  defp answer(from, body, result) do
    text =
      case result do
        :checked ->
          "✅ Done! Go back to PakChat. It carries on by itself."

        :expired ->
          "⌛ That code has run out. Open PakChat and tap Continue with WhatsApp again."

        :no_code ->
          if String.contains?(String.downcase(body), "pakchat"),
            do:
              "That code didn't work. Open PakChat and tap Continue with WhatsApp to get a new one."
      end

    if text, do: send_text(from, text)
    :ok
  end

  @doc "Sends a WhatsApp text from PakChat's number (only once the token and number id are set)."
  def send_text(to, text) do
    sender = Application.get_env(:pakchat, :whatsapp_send, &post_text/2)
    c = config()

    if is_binary(c[:token]) and c[:token] != "" and is_binary(c[:phone_number_id]) and
         c[:phone_number_id] != "" do
      Task.start(fn -> sender.(to, text) end)
    end

    :ok
  end

  defp post_text(to, text) do
    c = config()

    case Req.post("https://graph.facebook.com/v21.0/#{c[:phone_number_id]}/messages",
           json: %{messaging_product: "whatsapp", to: to, type: "text", text: %{body: text}},
           auth: {:bearer, c[:token]},
           retry: false
         ) do
      {:ok, %{status: status}} when status in 200..299 -> :ok
      other -> Logger.error("whatsapp: the reply wasn't sent: #{inspect(other)}")
    end
  end

  ## Helpers

  # Every word of 6 letters/digits in the message, as a code would look.
  defp codes_in(body) do
    ~r/\b[A-Z0-9]{6}\b/
    |> Regex.scan(String.upcase(body))
    |> List.flatten()
    |> Enum.uniq()
  end

  # A code no check that's still waiting has.
  defp free_code do
    code = for _ <- 1..6, into: "", do: <<Enum.random(@alphabet)>>
    now = DateTime.utc_now()

    taken? =
      Repo.exists?(
        from c in Check, where: c.code == ^code and is_nil(c.phone) and c.expires_at > ^now
      )

    if taken?, do: free_code(), else: code
  end

  defp hash(secret), do: :crypto.hash(:sha256, secret)

  defp config, do: Application.get_env(:pakchat, :whatsapp, [])
  defp number, do: config()[:number]
  defp app_secret, do: config()[:app_secret]
  defp verify_token, do: config()[:verify_token]
end
