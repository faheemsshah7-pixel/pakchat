defmodule Pakchat.Repo.Migrations.ChatsAnswered do
  @moduledoc """
  A one-to-one chat remembers whether the person who didn't start it has
  answered. From then on both can see how to reach the other (their number
  and Gmail), so "Add to contacts" fills them in on both phones.
  """
  use Ecto.Migration

  def change do
    alter table(:chats) do
      add :answered, :boolean, default: false, null: false
    end
  end
end
