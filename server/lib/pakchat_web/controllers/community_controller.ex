defmodule PakchatWeb.CommunityController do
  @moduledoc """
  Communities: groups gathered under one name, with an announcements group
  where only admins post. A community's people, admins, name and invite link
  use the group addresses (`/api/groups/:id/...`); these are the rest.
  """
  use PakchatWeb, :controller
  alias Pakchat.{Chats, RateLimit}
  alias PakchatWeb.Wire

  action_fallback PakchatWeb.FallbackController

  @fields ["title", "description", "photo"]

  @doc "`POST /api/communities` with `{title, description?, group_ids?}`."
  def create(conn, params) do
    me = conn.assigns.user

    with :ok <- RateLimit.hit(:groups, me.id),
         {:ok, community} <-
           Chats.create_community(me, Map.take(params, @fields), params["group_ids"] || []) do
      conn |> put_status(201) |> json(Wire.chat(community, me.id))
    end
  end

  @doc "`GET /api/communities/:id/groups`: the community and its groups."
  def groups(conn, %{"id" => id}) do
    me = conn.assigns.user

    with {:ok, community, groups, requested} <- Chats.community_groups(me, id) do
      json(conn, %{
        community: Wire.chat(community, me.id),
        groups: Enum.map(groups, &Wire.community_group(&1, me.id, requested))
      })
    end
  end

  @doc "`POST /api/communities/:id/groups` with `{group_ids}` (link mine) or `{title, description?}` (a new one)."
  def add_groups(conn, %{"id" => id} = params) do
    me = conn.assigns.user
    attrs = if is_binary(params["title"]), do: Map.take(params, @fields)

    with :ok <- RateLimit.hit(:groups, me.id),
         {:ok, made} <- Chats.add_community_groups(me, id, params["group_ids"] || [], attrs) do
      json(conn, %{group_id: made})
    end
  end

  def remove_group(conn, %{"id" => id, "group_id" => group_id}) do
    with {:ok, _} <- Chats.remove_community_group(conn.assigns.user, id, group_id),
         do: send_resp(conn, 204, "")
  end

  @doc """
  `POST /api/communities/:id/groups/:group_id/join`: the group, or (its admins
  approve who joins) 202 `{requested: true}`.
  """
  def join_group(conn, %{"id" => id, "group_id" => group_id}) do
    me = conn.assigns.user

    case Chats.join_community_group(me, id, group_id) do
      {:ok, :requested} -> conn |> put_status(202) |> json(%{requested: true})
      {:ok, chat} -> json(conn, Wire.chat(chat, me.id))
      error -> error
    end
  end

  @doc "`DELETE /api/communities/:id`: deactivates it. Its owner only."
  def deactivate(conn, %{"id" => id}) do
    with {:ok, _} <- Chats.deactivate_community(conn.assigns.user, id),
         do: send_resp(conn, 204, "")
  end

  @doc "`POST /api/communities/:id/suggestions` with `{group_ids}` (mine) and/or `{title}` (a new group)."
  def suggest(conn, %{"id" => id} = params) do
    me = conn.assigns.user
    title = if is_binary(params["title"]), do: String.trim(params["title"])

    with :ok <- RateLimit.hit(:groups, me.id),
         {:ok, _} <- Chats.suggest_community_groups(me, id, params["group_ids"] || [], title),
         do: send_resp(conn, 204, "")
  end

  @doc "`GET /api/communities/:id/suggestions`: all of them for its admins, my own for anyone else."
  def suggestions(conn, %{"id" => id}) do
    with {:ok, list} <- Chats.community_suggestions(conn.assigns.user, id) do
      json(conn, %{
        suggestions:
          Enum.map(list, fn {s, group} ->
            %{
              id: s.id,
              title: s.title || (group && group.title),
              photo: group && group.photo,
              members: if(group, do: length(group.members), else: 0),
              new: is_nil(s.group_id),
              suggested_by: s.suggested_by,
              at: s.inserted_at
            }
          end)
      })
    end
  end

  def approve_suggestion(conn, %{"id" => id, "suggestion_id" => sid}) do
    with {:ok, _} <- Chats.approve_suggestion(conn.assigns.user, id, sid),
         do: send_resp(conn, 204, "")
  end

  def drop_suggestion(conn, %{"id" => id, "suggestion_id" => sid}) do
    with {:ok, _} <- Chats.drop_suggestion(conn.assigns.user, id, sid),
         do: send_resp(conn, 204, "")
  end
end
