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
  end

  # Everything after sign-in: needs a device's session token.
  pipeline :signed_in do
    plug PakchatWeb.Plugs.Auth
  end

  scope "/", PakchatWeb do
    pipe_through :browser

    get "/", PageController, :home
  end

  # Everything the app and the website talk to lives under /api.
  scope "/api", PakchatWeb do
    pipe_through :api

    get "/health", HealthController, :show
    post "/auth/google", AuthController, :google
  end

  scope "/api", PakchatWeb do
    pipe_through [:api, :signed_in]

    delete "/auth/session", AuthController, :sign_out

    get "/me", MeController, :show
    patch "/me", MeController, :update
    put "/me/push", MeController, :push

    get "/keys", KeyController, :count
    post "/keys", KeyController, :upload

    get "/users/lookup", UserController, :lookup
    get "/users/:id", UserController, :show
    get "/users/:id/presence", UserController, :presence
    get "/users/:id/devices", KeyController, :devices
    post "/users/:id/bundles", KeyController, :bundles

    get "/chats", ChatController, :index
    post "/chats/direct", ChatController, :direct
    get "/chats/:id", ChatController, :show

    post "/groups", GroupController, :create
    patch "/groups/:id", GroupController, :update
    post "/groups/:id/members", GroupController, :add_members
    delete "/groups/:id/members/:user_id", GroupController, :remove_member
    put "/groups/:id/admins/:user_id", GroupController, :make_admin
    delete "/groups/:id/admins/:user_id", GroupController, :remove_admin
    post "/groups/:id/invite", GroupController, :reset_invite
    delete "/groups/:id/invite", GroupController, :remove_invite

    get "/invites/:code", InviteController, :show
    post "/invites/:code/join", InviteController, :join

    get "/blocks", BlockController, :index
    put "/blocks/:user_id", BlockController, :create
    delete "/blocks/:user_id", BlockController, :delete
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
end
