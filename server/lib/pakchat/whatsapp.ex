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
  @purposes ["sign_in", "link", "delete"]

  @doc "Whether WhatsApp checks are switched on."
  def on?, do: Enum.all?([number(), app_secret(), verify_token()], &(is_binary(&1) and &1 != ""))

  @doc """
  Starts a check. Answers the check's id, the secret the app keeps, the code,
  and the WhatsApp link that opens a chat with the message ready.

  `typed` is the number the person typed in the app (build 16 on). The code then
  only counts when it comes from that number. Apps before build 16 send none.
  """
  def start(purpose, typed \\ nil)

  def start(purpose, typed) when purpose in @purposes and (is_nil(typed) or is_binary(typed)) do
    with true <- on?() || {:error, :not_found},
         {:ok, typed_phone} <- typed_number(typed) do
      code = free_code()
      secret = Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)
      text = "PakChat code: #{code}"

      check =
        Repo.insert!(%Check{
          code: code,
          secret_hash: hash(secret),
          purpose: purpose,
          typed_phone: typed_phone,
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
    end
  end

  def start(_, _), do: {:error, :bad_request}

  defp typed_number(nil), do: {:ok, nil}
  defp typed_number(""), do: {:ok, nil}
  defp typed_number(text), do: Phone.normalize(text)

  @doc """
  A WhatsApp message reached PakChat's number. `from` is the sender's number
  as WhatsApp gives it (digits, with the country code). Answers `:checked`,
  `:no_code`, `:expired`, or `:wrong_number` (the app asked for another number;
  the code still works from the right one until it runs out).
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
      cond do
        DateTime.compare(check.expires_at, now) != :gt ->
          :expired

        check.typed_phone != nil and check.typed_phone != phone ->
          check |> Ecto.Changeset.change(wrong_phone: phone) |> Repo.update!()
          :wrong_number

        true ->
          check |> Ecto.Changeset.change(phone: phone) |> Repo.update!()
          :checked
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
  `{:ok, {:wrong_number, phone}}` while the only code that came was sent from
  another number than the one typed. `{:ok, :hidden_number}` while the only code
  came from someone whose WhatsApp hides their number (it can't count).
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

        DateTime.compare(check.expires_at, now) == :gt and check.wrong_phone != nil ->
          {:ok, {:wrong_number, check.wrong_phone}}

        DateTime.compare(check.expires_at, now) == :gt and check.number_hidden ->
          {:ok, :hidden_number}

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

  @doc """
  Handles everything in one webhook delivery from Meta (it may hold several messages).

  People who take a WhatsApp username (from 2026) can hide their number from
  businesses. Meta then sends a business-scoped user id (`from_user_id`, and
  `user_id` in `contacts`) and may leave the number out of `from`. The number is
  what we check, so: the number from `from`, else from the sender's contact
  (`wa_id`); with no number at all the code can't count (`:hidden_number`) and
  we answer by the user id, telling them to continue with Google.
  """
  def handle_webhook(%{"entry" => entries}) when is_list(entries) do
    for %{"changes" => changes} <- entries,
        is_list(changes),
        %{"value" => %{"messages" => messages} = value} <- changes,
        is_list(messages),
        %{"type" => "text", "text" => %{"body" => body}} = message <- messages,
        is_binary(body) do
      {phone, user_id} = sender(message, value["contacts"])

      result = if phone, do: received(phone, body), else: hidden(body)
      who = if phone, do: "..." <> String.slice(phone, -4, 4), else: "a hidden number"
      Logger.info("whatsapp: a code from #{who}: #{result}")
      answer(phone || {:user_id, user_id}, body, result)
      result
    end
  end

  def handle_webhook(_), do: []

  # The sender's number (digits only) and Meta's user id for them, either may be nil.
  defp sender(message, contacts) do
    user_id = text_or_nil(message["from_user_id"])
    contact = contact(message, user_id, contacts)
    phone = digits(message["from"]) || digits(contact["wa_id"])
    {phone, user_id || text_or_nil(contact["user_id"])}
  end

  # The contact Meta sent with the message: by user id, by number, or the only one.
  defp contact(message, user_id, contacts) when is_list(contacts) do
    contacts = Enum.filter(contacts, &is_map/1)

    Enum.find(contacts, &(user_id != nil and &1["user_id"] == user_id)) ||
      Enum.find(contacts, &(&1["wa_id"] != nil and &1["wa_id"] == message["from"])) ||
      if(match?([_], contacts), do: hd(contacts), else: %{})
  end

  defp contact(_, _, _), do: %{}

  defp digits(text) when is_binary(text), do: if(text =~ ~r/^\d{6,15}$/, do: text)
  defp digits(_), do: nil

  defp text_or_nil(text) when is_binary(text) and text != "", do: text
  defp text_or_nil(_), do: nil

  # A code came but WhatsApp didn't say from which number. It can't count; the
  # check remembers it, so the app can say why (claim/2).
  defp hidden(body) do
    codes = codes_in(body)
    now = DateTime.utc_now()

    {marked, _} =
      if codes == [],
        do: {0, nil},
        else:
          Repo.update_all(
            from(c in Check,
              where: c.code in ^codes and is_nil(c.phone) and c.expires_at > ^now
            ),
            set: [number_hidden: true]
          )

    if marked > 0, do: :hidden_number, else: :no_code
  end

  # Tells the person how it went, when we can send messages back. Replies inside
  # the 24 hours after their message are free. Random chats to the number get no answer.
  defp answer(from, body, result) do
    text =
      case result do
        :checked ->
          "✅ Done! Go back to PakChat. It carries on by itself."

        :expired ->
          "⌛ That code has run out. Open PakChat and tap Continue with WhatsApp again."

        :wrong_number ->
          "This code is for a different number. Send it from the WhatsApp of the number you typed in PakChat."

        :hidden_number ->
          "Your WhatsApp username is hiding your number, so we can't check it this way. Go back to PakChat and continue with Google."

        :no_code ->
          if String.contains?(String.downcase(body), "pakchat"),
            do:
              "That code didn't work. Open PakChat and tap Continue with WhatsApp to get a new one."
      end

    if text && from != {:user_id, nil}, do: send_text(from, text)
    :ok
  end

  @doc """
  Sends a WhatsApp text from PakChat's number (only once the token and number id
  are set). `to` is a number (digits), or `{:user_id, id}` for someone whose
  number WhatsApp hides.
  """
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
           json:
             Map.merge(
               %{messaging_product: "whatsapp", type: "text", text: %{body: text}},
               address(to)
             ),
           auth: {:bearer, c[:token]},
           retry: false
         ) do
      {:ok, %{status: status}} when status in 200..299 -> :ok
      other -> Logger.error("whatsapp: the reply wasn't sent: #{inspect(other)}")
    end
  end

  ## Helpers

  # Meta wants `to` for a number and `recipient` for a user id, never both.
  defp address({:user_id, id}), do: %{recipient: id}
  defp address(number), do: %{to: number}

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
