// Qr.tsx: a QR code drawn as one SVG path, with PakChat's logo in the middle.

import { create } from 'qrcode';
import { useMemo } from 'react';

export function Qr({ text, size, logo = true }: { text: string; size: number; logo?: boolean }) {
  const { n, d } = useMemo(() => {
    // "Q" keeps it readable with a quarter of it covered, so the logo can sit on top.
    const qr = create(text, { errorCorrectionLevel: logo ? 'Q' : 'M' });
    const count = qr.modules.size;
    let path = '';
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.modules.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
    return { n: count, d: path };
  }, [text, logo]);
  const box = n * 0.22;
  const at = (n - box) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Scan this QR code to link a device">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#0B1B36" />
      {logo && (
        <g shapeRendering="auto">
          <rect x={at - 0.6} y={at - 0.6} width={box + 1.2} height={box + 1.2} rx={box * 0.3} fill="#fff" />
          <rect x={at} y={at} width={box} height={box} rx={box * 0.26} fill="#2563EB" />
          <path
            transform={`translate(${at + box * 0.2} ${at + box * 0.22}) scale(${(box * 0.6) / 16})`}
            d="M1.5 2.5h13v8.5H6L1.5 14.5z"
            fill="none"
            stroke="#fff"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
}
