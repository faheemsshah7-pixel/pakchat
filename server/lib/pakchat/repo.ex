defmodule Pakchat.Repo do
  use Ecto.Repo,
    otp_app: :pakchat,
    adapter: Ecto.Adapters.Postgres
end
