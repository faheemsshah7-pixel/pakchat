// Logo.tsx: the PakChat logo. A chat bubble with the crescent and star from the flag.
// Its colours come from the current look (--logo-a and --logo-b in index.css).
import { useId } from 'react'

export default function Logo({ size = 40 }: { size?: number }) {
  const id = useId() // unique names, in case two logos are on the page
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id={id + 'g'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--logo-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--logo-b)' }} />
        </linearGradient>
        {/* The crescent is a circle with a bite taken out of it. */}
        <mask id={id + 'm'}>
          <rect width="48" height="48" fill="white" />
          <circle cx="25.6" cy="19.8" r="7.9" fill="black" />
        </mask>
      </defs>
      <path
        d="M24 4C12.95 4 4 12.06 4 22c0 5.3 2.55 10.06 6.6 13.35L9 44l8.56-4.6c2.03.56 4.2.86 6.44.86 11.05 0 20-8.06 20-18S35.05 4 24 4z"
        fill={`url(#${id}g)`}
      />
      <circle cx="21.6" cy="22.8" r="9.6" fill="white" mask={`url(#${id}m)`} />
      <polygon
        points="30.15 12.37 31.63 14.27 33.95 13.60 32.60 15.60 33.95 17.60 31.63 16.93 30.15 18.83 30.07 16.42 27.80 15.60 30.07 14.78"
        fill="white"
      />
    </svg>
  )
}
