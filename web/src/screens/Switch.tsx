// Switch.tsx: an on/off switch with a label, for settings.
export default function Switch({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button className="setting" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="setting-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <span className={on ? 'switch on' : 'switch'} aria-hidden />
    </button>
  )
}
