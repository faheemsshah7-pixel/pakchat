defmodule PakchatWeb.PageController do
  use PakchatWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
