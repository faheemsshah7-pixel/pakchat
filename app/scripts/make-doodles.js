// make-doodles.js: draws the chat wallpaper's doodle tile (ui/chat/Backdrop.tsx) as
// pictures, one for each tint, three times as sharp as the screen's points, into
// assets/wallpaper. The chat shows them side by side, like WhatsApp's wallpaper: a
// small ready-made picture is much quicker to show than drawing the doodles each
// time a chat opens. Run from app/ with: node scripts/make-doodles.js (uses Playwright).
/* global __dirname */
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'assets', 'wallpaper');
/** The doodles' shapes, the same as in src/ui/icons.tsx. */
const ICONS = {
  camera: { d: ['M4 8h3l2-3h6l2 3h3v11H4z'], circles: [[12, 13, 3.5]] },
  chat: { d: ['M4 5h16v11H9l-5 4z'] },
  emoji: { d: ['M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01'], circles: [[12, 12, 9]] },
  star: { d: ['M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z'] },
  sun: { d: ['M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'], circles: [[12, 12, 4]] },
  moon: { d: ['M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z'] },
  heart: { d: ['M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'] },
  music: { d: ['M9 18V6l10-2v12'], circles: [[6.5, 18, 2.5], [16.5, 16, 2.5]] },
};
const DOODLES = [['moon', 10, 8, -14], ['star', 70, 4, 12], ['heart', 128, 26, -8], ['music', 38, 58, 10], ['sun', 100, 72, 0], ['camera', 8, 112, -10], ['emoji', 66, 124, 8], ['chat', 134, 132, -12]];
const TILE = 176;
/** The tints in Backdrop.tsx: PakChat's own wallpaper (light, dark), and doodles over a colour. */
const TINTS = { 'light': 'rgba(37,99,235,0.08)', 'dark': 'rgba(255,255,255,0.045)', 'colour-light': 'rgba(11,27,54,0.07)', 'colour-dark': 'rgba(255,255,255,0.06)' };
function svg(color) {
  const stroke = 1.6;
  const shapes = (name) => {
    const s = ICONS[name];
    let out = '';
    for (const d of s.d || []) out += `<path d="${d}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
    for (const [cx, cy, r] of s.circles || []) out += `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"/>`;
    return out;
  };
  // The same tile repeated 3x3, so doodles crossing an edge wrap like the pattern does; the middle one is kept.
  let g = '';
  for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE])
    for (const [name, x, y, turn] of DOODLES) g += `<g transform="translate(${ox + x} ${oy + y}) rotate(${turn} 12 12) scale(1.15)">${shapes(name)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">${g}</svg>`;
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: TILE, height: TILE }, deviceScaleFactor: 3 });
  for (const [name, color] of Object.entries(TINTS)) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(color)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, `doodles-${name}@3x.png`), omitBackground: true, clip: { x: 0, y: 0, width: TILE, height: TILE } });
  }
  await browser.close();
})();
