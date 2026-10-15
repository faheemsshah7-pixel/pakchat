// screen.ts: on a phone, keep the app inside the part of the screen you can see.
//
// When you tap the message box, the keyboard slides up over the bottom half of the screen.
// Android can be told to shrink the page above it (index.html: interactive-widget=resizes-content).
// iPhones don't shrink the page: they just slide it up, so the top bar went off the screen
// and the chat looked cut in half. So we watch the "visual viewport" (the part you can see)
// and tell the CSS its size and position, in --screen-height and --screen-top (index.css, part 4).
export function fitToScreen() {
  const seen = window.visualViewport
  if (!seen) return // very old browsers: the normal full-screen layout still works
  const root = document.documentElement.style
  function update() {
    if (!seen) return
    // Zoomed in with two fingers: the visible part is small on purpose, so leave the layout alone.
    if (seen.scale > 1.01) {
      root.removeProperty('--screen-height')
      root.removeProperty('--screen-top')
      return
    }
    root.setProperty('--screen-height', `${seen.height}px`)
    root.setProperty('--screen-top', `${seen.offsetTop}px`)
  }
  seen.addEventListener('resize', update)
  seen.addEventListener('scroll', update)
  update()
}
