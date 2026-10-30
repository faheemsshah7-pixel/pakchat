// Icon.tsx: draws one icon from icons.ts. Lines take the text colour around them.

import { ICONS, type IconName, type Shape } from './icons';

export function Icon({ name, size = 24, stroke }: { name: IconName; size?: number; stroke?: number }) {
  const s: Shape = ICONS[name];
  const w = stroke ?? (size <= 16 ? 2 : 1.9);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {s.d?.map((d, i) => <path key={`d${i}`} d={d} />)}
      {s.fill?.map((d, i) => <path key={`f${i}`} d={d} fill="currentColor" stroke="none" />)}
      {s.circles?.map(([cx, cy, r], i) => <circle key={`c${i}`} cx={cx} cy={cy} r={r} />)}
      {s.dots?.map(([cx, cy, r], i) => <circle key={`o${i}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />)}
      {s.rects?.map(([x, y, rw, rh, r], i) => <rect key={`r${i}`} x={x} y={y} width={rw} height={rh} rx={r} />)}
    </svg>
  );
}

/** Status: a broken ring around a dot, like WhatsApp's. */
export function StatusIcon({ size = 24, stroke = 1.8 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} aria-hidden>
      <circle cx="12" cy="12" r="9.5" strokeDasharray="10.5 3.2" />
      <circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The little corner on the first bubble of a run. */
export function Tail({ out }: { out: boolean }) {
  return (
    <svg className="tail" viewBox="0 0 8 13" width="8" height="13" aria-hidden>
      <path
        fill="currentColor"
        d={out ? 'M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z' : 'M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z'}
      />
    </svg>
  );
}

/** "GET IT ON Google Play" once PakChat is public there; until then, "Download for Android" (the APK). */
export function PlayBadge({ play }: { play: boolean }) {
  if (!play) {
    return (
      <span className="gplay">
        <Icon name="download2" size={22} />
        <span>
          <small>DOWNLOAD FOR</small>Android
        </span>
      </span>
    );
  }
  return (
    <span className="gplay">
      <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden>
        <path d="M1 1.5l11.5 10.5L1 22.5z" fill="#34A853" />
        <path d="M1 1.5l15 8.4-3.5 2.1z" fill="#FBBC04" />
        <path d="M1 22.5l15-8.4-3.5-2.1z" fill="#EA4335" />
        <path d="M16 9.9l4.5 2.1-4.5 2.1-3.5-2.1z" fill="#4285F4" />
      </svg>
      <span>
        <small>GET IT ON</small>Google Play
      </span>
    </span>
  );
}
