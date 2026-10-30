defmodule PakchatWeb.FallbackController do
  @moduledoc """
  Turns errors from the other controllers into answers with the right status.
  (A controller that returns `{:error, something}` ends up here.)
  """
  use PakchatWeb, :controller
  alias PakchatWeb.Wire

  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    conn |> put_status(422) |> json(%{error: "invalid", fields: Wire.errors(changeset)})
  end

  def call(conn, {:error, reason}) when is_atom(reason) do
    conn |> put_status(status(reason)) |> json(%{error: reason})
  end

  def call(conn, nil), do: call(conn, {:error, :not_found})

  # Not found and "not yours" look the same on purpose, so nobody can
  # find out what exists by poking at it.
  defp status(:not_found), do: 404
  defp status(:forbidden), do: 403
  defp status(:bad_request), do: 400
  defp status(:rate_limited), do: 429
  defp status(:unavailable), do: 503
  defp status(:storage_full), do: 507
  defp status(_), do: 422
end
