// favicon.ts: the little icon on the browser tab. Like WhatsApp Web, it shows a number
// when chats have something unread (1 to 9, 10 to 99, 99+), and turns grey with a
// yellow dot while PakChat can't reach the server.

const SIZE = 64;
let base: HTMLImageElement | null = null;
let want = { count: 0, offline: false };
let shown = '';

function link(): HTMLLinkElement {
  let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'icon';
    document.head.appendChild(el);
  }
  return el;
}

function draw() {
  const { count, offline } = want;
  const key = `${count}|${offline}`;
  if (key === shown) return;
  if (!count && !offline) {
    shown = key;
    link().href = '/favicon.png';
    return;
  }
  if (!base?.complete || !base.naturalWidth) return; // draws once the picture has loaded
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return;
  if (offline) g.filter = 'grayscale(1) opacity(.7)';
  g.drawImage(base, 0, 0, SIZE, SIZE);
  g.filter = 'none';
  if (offline) {
    dot(g, 50, 50, 13, '#F5B400');
  } else {
    const text = count > 99 ? '99+' : String(count);
    const w = text.length === 1 ? 34 : text.length === 2 ? 44 : 56;
    const h = 34;
    const x = SIZE - w;
    g.fillStyle = '#fff';
    pill(g, x - 2, -2, w + 4, h + 4);
    g.fillStyle = '#D42A3C';
    pill(g, x, 0, w, h);
    g.fillStyle = '#fff';
    g.font = `700 ${text.length === 3 ? 22 : 26}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + w / 2, h / 2 + 2);
  }
  shown = key;
  link().href = c.toDataURL('image/png');
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  g.closePath();
  g.fill();
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(x, y, r + 3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Shows `count` unread chats on the tab's icon, or the grey "offline" icon. */
export function setFavicon(count: number, offline: boolean) {
  want = { count, offline };
  if (!base && (count || offline)) {
    base = new Image();
    base.onload = draw;
    base.src = '/favicon.png';
  }
  draw();
}
