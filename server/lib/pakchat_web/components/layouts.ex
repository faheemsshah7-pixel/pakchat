defmodule PakchatWeb.Layouts do
  @moduledoc """
  The page shell for the few pages the server shows itself.

  The phone app and the website are the real front ends. This server only needs
  a handful of plain pages (a "it works" page now, the QR linking page later),
  so the layout is deliberately tiny.
  """
  use PakchatWeb, :html

  embed_templates "layouts/*"

  @doc "Wraps page content in the main area."
  attr :flash, :map, required: true
  slot :inner_block, required: true

  def app(assigns) do
    ~H"""
    <main>
      <.flash_group flash={@flash} />
      {render_slot(@inner_block)}
    </main>
    """
  end

  @doc "Shows any one-off messages Phoenix put in the session."
  attr :flash, :map, required: true
  attr :id, :string, default: "flash-group"

  def flash_group(assigns) do
    ~H"""
    <div id={@id} aria-live="polite">
      <div :if={Phoenix.Flash.get(@flash, :info)} class="flash">
        {Phoenix.Flash.get(@flash, :info)}
      </div>
      <div :if={Phoenix.Flash.get(@flash, :error)} class="flash">
        {Phoenix.Flash.get(@flash, :error)}
      </div>
    </div>
    """
  end
end
