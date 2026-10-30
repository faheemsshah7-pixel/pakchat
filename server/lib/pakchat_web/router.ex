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
    # Invite and call links shared outside PakChat open a page that opens the app.
    get "/join/:code", PageController, :join
    get "/calllink/:code", PageController, :call_link
  end

  # Everything the app and the website talk to lives under /api.
  scope "/api", PakchatWeb do
    pipe_through :api

    get "/health", HealthController, :show
    post "/auth/google", AuthController, :google
    post "/auth/phone/code", AuthController, :phone_code
    post "/auth/phone", AuthController, :phone
    get "/auth/test", AuthController, :test
    post "/auth/test", AuthController, :test
    get "/auth/test/code", AuthController, :test_code

    # A website asking for a QR code to link to a phone (see LinkController).
    post "/link", LinkController, :start
    post "/link/:id/code", LinkController, :new_code
    post "/link/:id/phone", LinkController, :phone

    # Signed links: the token in the link is the permission (see Pakchat.Files).
    put "/files/:id/data", FileController, :upload
    get "/files/:id/data", FileController, :download
  end

  scope "/api", PakchatWeb do
    pipe_through [:api, :signed_in]

    delete "/auth/session", AuthController, :sign_out

    get "/me", MeController, :show
    patch "/me", MeController, :update
    put "/me/push", MeController, :push
    put "/me/google", MeController, :link_google
    post "/me/phone/code", MeController, :phone_code
    put "/me/phone", MeController, :link_phone
    delete "/me/:what", MeController, :unlink

    # The phone approving a QR code, and its linked devices.
    get "/link/:code", LinkController, :show
    post "/link/:code", LinkController, :approve
    get "/me/devices", LinkController, :devices
    get "/me/pairing", LinkController, :pairing
    delete "/me/devices/:device_id", LinkController, :remove

    post "/contacts/match", UserController, :match

    get "/files/limits", FileController, :limits
    post "/files", FileController, :create
    post "/photos", FileController, :create_photo
    get "/files/:id/link", FileController, :link

    get "/backup", BackupController, :show
    post "/backup", BackupController, :create
    delete "/backup", BackupController, :delete

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
    get "/groups/:id/requests", GroupController, :requests
    post "/groups/:id/requests/:user_id", GroupController, :approve_request
    delete "/groups/:id/requests/:user_id", GroupController, :drop_request

    get "/invites/:code", InviteController, :show
    post "/invites/:code/join", InviteController, :join

    post "/communities", CommunityController, :create
    get "/communities/:id/groups", CommunityController, :groups
    post "/communities/:id/groups", CommunityController, :add_groups
    delete "/communities/:id/groups/:group_id", CommunityController, :remove_group
    post "/communities/:id/groups/:group_id/join", CommunityController, :join_group
    delete "/communities/:id", CommunityController, :deactivate
    post "/communities/:id/suggestions", CommunityController, :suggest
    get "/communities/:id/suggestions", CommunityController, :suggestions
    post "/communities/:id/suggestions/:suggestion_id", CommunityController, :approve_suggestion
    delete "/communities/:id/suggestions/:suggestion_id", CommunityController, :drop_suggestion

    post "/reports", ReportController, :create

    get "/calls/ice", CallController, :ice
    post "/calls/links", CallController, :create_link
    put "/status/audience", StatusController, :audience
    get "/gifs", GifController, :index

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
