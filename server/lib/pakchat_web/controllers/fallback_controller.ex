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

  # Two-step PIN (Pakchat.Pin): the sign-in needs it, it was wrong, or it has to wait.
  def call(conn, {:error, {:pin_needed, info}}) do
    conn
    |> put_status(403)
    |> json(%{
      error: "pin_needed",
      ticket: info.ticket,
      google: info.google,
      reset_at: info.reset_at
    })
  end

  def call(conn, {:error, {:wrong_pin, tries_left}}) do
    conn |> put_status(403) |> json(%{error: "wrong_pin", tries_left: tries_left})
  end

  def call(conn, {:error, {:pin_locked, seconds}}) do
    conn |> put_status(429) |> json(%{error: "pin_locked", wait: seconds})
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
  defp status(:bad_ticket), do: 401
  defp status(:wrong_google), do: 403
  defp status(:wrong_current), do: 403
  defp status(:rate_limited), do: 429
  defp status(:unavailable), do: 503
  defp status(:storage_full), do: 507
  defp status(_), do: 422
end
