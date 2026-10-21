defmodule PakchatWeb.Params do
  @moduledoc """
  Reads what the app sends: checks the shape, and turns base64 text back
  into bytes. Anything that doesn't fit gives `{:error, :bad_request}`.
  """

  @doc """
  A device's public keys, as sent when signing in:

      %{"registration_id" => 1234, "identity_key" => "BQ…",
        "signed_pre_key" => %{"key_id" => 1, "public_key" => "BQ…", "signature" => "…"},
        "kyber_last_resort" => %{"key_id" => 1, "public_key" => "…", "signature" => "…"},
        "name" => "Pixel 7"}
  """
  def device(%{} = p) do
    with {:ok, reg} <- int(p["registration_id"]),
         {:ok, identity} <- bytes(p["identity_key"]),
         {:ok, signed} <- signed_key(p["signed_pre_key"]),
         {:ok, kyber} <- signed_key(p["kyber_last_resort"]) do
      {:ok,
       %{
         name: if(is_binary(p["name"]), do: p["name"], else: "Phone"),
         registration_id: reg,
         identity_key: identity,
         signed_pre_key_id: signed.key_id,
         signed_pre_key: signed.public_key,
         signed_pre_key_signature: signed.signature,
         kyber_last_resort_id: kyber.key_id,
         kyber_last_resort_key: kyber.public_key,
         kyber_last_resort_signature: kyber.signature
       }}
    end
  end

  def device(_), do: {:error, :bad_request}

  @doc "New keys for `POST /api/keys`: any of signed_pre_key, kyber_last_resort, pre_keys, kyber_pre_keys."
  def key_upload(p) do
    with {:ok, ec} <- list(p["pre_keys"], &key/1),
         {:ok, kyber} <- list(p["kyber_pre_keys"], &signed_key/1),
         {:ok, signed} <- optional(p["signed_pre_key"], &signed_key/1),
         {:ok, last} <- optional(p["kyber_last_resort"], &signed_key/1) do
      rotate =
        %{}
        |> put_signed(signed, :signed_pre_key)
        |> put_signed(last, :kyber_last_resort)

      {:ok, %{ec: ec, kyber: kyber, rotate: rotate}}
    end
  end

  defp put_signed(map, nil, _), do: map

  defp put_signed(map, k, :signed_pre_key) do
    Map.merge(map, %{
      signed_pre_key_id: k.key_id,
      signed_pre_key: k.public_key,
      signed_pre_key_signature: k.signature
    })
  end

  defp put_signed(map, k, :kyber_last_resort) do
    Map.merge(map, %{
      kyber_last_resort_id: k.key_id,
      kyber_last_resort_key: k.public_key,
      kyber_last_resort_signature: k.signature
    })
  end

  @doc "What a device sends with a message (see `Pakchat.Relay.send_message/3`)."
  def message(%{"chat_id" => chat_id} = p) when is_binary(chat_id) do
    with {:ok, envelopes} <- list(p["envelopes"], &envelope/1),
         {:ok, group} <- optional(p["group"], &sealed/1) do
      {:ok, chat_id, %{kind: Map.get(p, "kind", "message"), envelopes: envelopes, group: group}}
    end
  end

  def message(_), do: {:error, :bad_request}

  defp envelope(%{"user_id" => user_id, "device_id" => device_id} = p)
       when is_binary(user_id) and is_integer(device_id) do
    with {:ok, sealed} <- sealed(p), {:ok, user_id} <- Ecto.UUID.cast(user_id) do
      {:ok, Map.merge(sealed, %{user_id: user_id, device_id: device_id})}
    else
      _ -> {:error, :bad_request}
    end
  end

  defp envelope(_), do: {:error, :bad_request}

  defp sealed(%{"type" => type, "body" => body}) when is_integer(type) do
    with {:ok, bytes} <- bytes(body), do: {:ok, %{type: type, body: bytes}}
  end

  defp sealed(_), do: {:error, :bad_request}

  defp key(%{"key_id" => id, "public_key" => pk}) do
    with {:ok, id} <- int(id), {:ok, pk} <- bytes(pk), do: {:ok, %{key_id: id, public_key: pk}}
  end

  defp key(_), do: {:error, :bad_request}

  defp signed_key(%{"signature" => sig} = p) do
    with {:ok, k} <- key(p), {:ok, sig} <- bytes(sig), do: {:ok, Map.put(k, :signature, sig)}
  end

  defp signed_key(_), do: {:error, :bad_request}

  defp list(nil, _fun), do: {:ok, []}

  defp list(items, fun) when is_list(items) do
    Enum.reduce_while(items, {:ok, []}, fn item, {:ok, acc} ->
      case fun.(item) do
        {:ok, value} -> {:cont, {:ok, [value | acc]}}
        _ -> {:halt, {:error, :bad_request}}
      end
    end)
    |> case do
      {:ok, acc} -> {:ok, Enum.reverse(acc)}
      error -> error
    end
  end

  defp list(_, _fun), do: {:error, :bad_request}

  defp optional(nil, _fun), do: {:ok, nil}
  defp optional(value, fun), do: fun.(value)

  defp int(n) when is_integer(n), do: {:ok, n}
  defp int(_), do: {:error, :bad_request}

  defp bytes(text) when is_binary(text) do
    case Base.decode64(text) do
      {:ok, bytes} -> {:ok, bytes}
      :error -> {:error, :bad_request}
    end
  end

  defp bytes(_), do: {:error, :bad_request}
end
