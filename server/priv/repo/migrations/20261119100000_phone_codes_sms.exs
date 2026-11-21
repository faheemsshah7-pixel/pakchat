defmodule Pakchat.Repo.Migrations.PhoneCodesSms do
  @moduledoc """
  `sms`: the code was sent by SMS. Codes proved by the WhatsApp check
  (PhoneCodes.allow/3) cost nothing and don't count towards the daily SMS cap.
  """
  use Ecto.Migration

  def change do
    alter table(:phone_codes) do
      add :sms, :boolean, null: false, default: true
    end
  end
end
