defmodule Pakchat.Keys do
  @moduledoc """
  Signal's public keys.

  To start a locked chat with a device, you need its "bundle": its identity
  key, its signed pre-key, and one each of its one-time keys. Each one-time
  key is handed out once and deleted. When a device runs low, it uploads
  more. If the Kyber ones run out, its "last resort" Kyber key is used.
  """
  import Ecto.Query
  alias Pakchat.Accounts.{Device, PreKey}
  alias Pakchat.Repo

  # Most keys a device may keep here, of each kind.
  @max_stored 200
  # Most keys a device may upload at once, of each kind.
  @max_upload 100

  @doc "How many one-time keys this device has left, so it knows when to upload more."
  def counts(%Device{id: id}) do
    counts =
      Repo.all(
        from k in PreKey, where: k.device_id == ^id, group_by: k.kind, select: {k.kind, count()}
      )
      |> Map.new()

    %{ec: Map.get(counts, "ec", 0), kyber: Map.get(counts, "kyber", 0)}
  end

  @doc """
  Saves new one-time keys. `ec` and `kyber` are lists of maps with
  `key_id`, `public_key` and (for Kyber) `signature`, already decoded.
  """
  def add_pre_keys(%Device{} = device, ec, kyber) do
    have = counts(device)

    cond do
      length(ec) > @max_upload or length(kyber) > @max_upload ->
        {:error, :too_many_keys}

      have.ec + length(ec) > @max_stored or have.kyber + length(kyber) > @max_stored ->
        {:error, :too_many_keys}

      true ->
        changesets =
          Enum.map(
            ec,
            &PreKey.changeset(%PreKey{}, Map.merge(&1, %{device_id: device.id, kind: "ec"}))
          ) ++
            Enum.map(
              kyber,
              &PreKey.changeset(%PreKey{}, Map.merge(&1, %{device_id: device.id, kind: "kyber"}))
            )

        case Enum.find(changesets, &(not &1.valid?)) do
          nil ->
            rows =
              Enum.map(
                changesets,
                &Map.take(&1.changes, [:device_id, :kind, :key_id, :public_key, :signature])
              )

            Repo.insert_all(PreKey, rows, on_conflict: :nothing)
            {:ok, counts(device)}

          invalid ->
            {:error, invalid}
        end
    end
  end

  @doc "Swaps in a new signed pre-key and/or last-resort Kyber key."
  def rotate(%Device{} = device, attrs) do
    device |> Device.rotate_changeset(attrs) |> Repo.update()
  end

  @doc """
  Hands out a bundle for each of a person's devices (or just the ones in
  `device_ids`), using up one one-time key of each kind per device.
  """
  def claim_bundles(user_id, device_ids \\ nil) do
    query = from d in Device, where: d.user_id == ^user_id, order_by: d.device_id

    query =
      if is_list(device_ids), do: where(query, [d], d.device_id in ^device_ids), else: query

    Repo.transaction(fn ->
      query |> Repo.all() |> Enum.map(&bundle/1)
    end)
  end

  defp bundle(%Device{} = d) do
    ec = take_one(d.id, "ec")

    kyber =
      take_one(d.id, "kyber") ||
        %{
          key_id: d.kyber_last_resort_id,
          public_key: d.kyber_last_resort_key,
          signature: d.kyber_last_resort_signature
        }

    %{
      device_id: d.device_id,
      registration_id: d.registration_id,
      identity_key: d.identity_key,
      signed_pre_key_id: d.signed_pre_key_id,
      signed_pre_key: d.signed_pre_key,
      signed_pre_key_signature: d.signed_pre_key_signature,
      pre_key_id: ec && ec.key_id,
      pre_key: ec && ec.public_key,
      kyber_pre_key_id: kyber.key_id,
      kyber_pre_key: kyber.public_key,
      kyber_pre_key_signature: kyber.signature
    }
  end

  # Takes the oldest key of this kind and deletes it, in one step. SKIP LOCKED
  # means two people asking at the same moment never get the same key.
  defp take_one(device_id, kind) do
    next =
      from k in PreKey,
        where: k.device_id == ^device_id and k.kind == ^kind,
        order_by: k.id,
        limit: 1,
        lock: "FOR UPDATE SKIP LOCKED",
        select: k.id

    case Repo.delete_all(from(k in PreKey, where: k.id in subquery(next), select: k)) do
      {1, [key]} -> key
      {0, _} -> nil
    end
  end
end
