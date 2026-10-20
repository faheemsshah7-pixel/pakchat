defmodule PakchatWeb.Router do
  use PakchatWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {PakchatWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
    plug :allow_other_sites
  end

  scope "/", PakchatWeb do
    pipe_through :browser

    get "/", PageController, :home
  end

  # Everything the app and the website talk to lives under /api.
  scope "/api", PakchatWeb do
    pipe_through :api

    get "/health", HealthController, :show
  end

  # Enable LiveDashboard in development
  if Application.compile_env(:pakchat, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: PakchatWeb.Telemetry
    end
  end

  # Browsers block a page from reading answers from a different address unless
  # the server says it is allowed. The app's web preview runs on port 8081 and
  # this server on 4000, which counts as different. The phone app itself does
  # not need this. Phase 2 narrows it down to PakChat's own addresses.
  defp allow_other_sites(conn, _opts) do
    put_resp_header(conn, "access-control-allow-origin", "*")
  end
end
