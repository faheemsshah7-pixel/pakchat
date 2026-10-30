// overlay.tsx: everything that floats above the app: menus, the reaction
// bar, dialogs and toasts. One at a time for menus, like WhatsApp Web; Esc,
// a click outside, scrolling or resizing closes them.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from './Icon';
import type { IconName } from './icons';

// ---- A tiny store for what's open ----

type Layer = { id: number; node: ReactNode; modal?: boolean };
let layers: Layer[] = [];
let toasts: { id: number; text: string; action?: { label: string; run: () => void } }[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** Opens a floating thing. Menus replace any other menu; dialogs stack. */
export function openLayer(node: ReactNode, modal = false) {
  const id = nextId++;
  layers = [...(modal ? layers : layers.filter((l) => l.modal)), { id, node, modal }];
  changed();
  return id;
}

export function closeLayer(id?: number) {
  layers = id == null ? layers.filter((l) => l.modal) : layers.filter((l) => l.id !== id);
  changed();
}

/** "Chat archived  Undo": at the bottom, for a few seconds. */
export function toast(text: string, action?: { label: string; run: () => void }) {
  const id = nextId++;
  // One at a time, like WhatsApp: a new one takes the old one's place.
  toasts = [{ id, text, action }];
  changed();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    changed();
  }, 5000);
}

/** Where floating things are drawn (once, at the top of the app). */
export function Overlays() {
  const snap = useSyncExternalStore(subscribe, () => layers);
  const ts = useSyncExternalStore(subscribe, () => toasts);
  const menus = snap.filter((l) => !l.modal);

  useEffect(() => {
    if (!menus.length) return;
    const close = () => closeLayer();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), close());
    window.addEventListener('resize', close);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', key, true);
    };
  }, [menus.length]);

  return createPortal(
    <>
      {snap.map((l) => (
        <div key={l.id} className={l.modal ? 'layer modal' : 'layer'} onMouseDown={(e) => e.target === e.currentTarget && closeLayer(l.modal ? l.id : undefined)} onContextMenu={(e) => (e.preventDefault(), e.target === e.currentTarget && closeLayer(l.modal ? l.id : undefined))}>
          {l.node}
        </div>
      ))}
      {ts.length > 0 && (
        <div className="toasts">
          {ts.map((t) => (
            <div key={t.id} className="toast">
              <span>{t.text}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.run();
                    toasts = toasts.filter((x) => x.id !== t.id);
                    changed();
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}

// ---- Placing a pop-up next to a point, inside the window ----

/**
 * Puts the element at (x, y), moving it left or up if it would go off
 * screen (menus near the bottom open upward, like WhatsApp Web).
 */
export function usePlace(x: number, y: number, opts: { above?: boolean; alignRight?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = opts.alignRight ? x - r.width : x;
    let top = opts.above ? y - r.height : y;
    let up = !!opts.above;
    if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width);
    if (left < 8) left = 8;
    if (top + r.height > innerHeight - 8) {
      top = Math.max(8, y - r.height);
      up = true;
    }
    if (top < 8) top = 8;
    setPos({ left, top, up });
  }, [x, y, opts.above, opts.alignRight]);
  return { ref, style: pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: 'hidden' as const }, up: pos?.up ?? false };
}

// ---- Menus ----

export type MenuItem =
  | '-'
  | {
      label: string;
      icon?: IconName;
      /** The icon's own colour (the attach menu). */
      color?: string;
      red?: boolean;
      keys?: string;
      /** Opens a second menu beside this one. */
      sub?: MenuItem[];
      run?: () => void;
    };

function MenuBox({ items, x, y, cls = '', above, head, onClose }: { items: MenuItem[]; x: number; y: number; cls?: string; above?: boolean; head?: ReactNode; onClose: () => void }) {
  const { ref, style } = usePlace(x, y, { above });
  const [sub, setSub] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  return (
    <>
      <div ref={ref} className={`menu pop ${cls}`} style={style} role="menu" onContextMenu={(e) => e.preventDefault()}>
        {head}
        {items.map((it, i) =>
          it === '-' ? (
            <div key={i} className="sep" />
          ) : (
            <button
              key={i}
              className={`mi ${it.red ? 'red' : ''}`}
              role="menuitem"
              onMouseEnter={(e) => {
                if (it.sub) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ items: it.sub, x: r.right + 4, y: r.top - 4 });
                } else setSub(null);
              }}
              onClick={(e) => {
                if (it.sub) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ items: it.sub, x: r.right + 4, y: r.top - 4 });
                  return;
                }
                onClose();
                it.run?.();
              }}
            >
              {it.icon && (
                <span className="mico" style={it.color ? { color: it.color } : undefined}>
                  <Icon name={it.icon} size={20} />
                </span>
              )}
              <span className="ml">{it.label}</span>
              {it.sub && (
                <span className="ms">
                  <Icon name="forwardArrow" size={16} />
                </span>
              )}
              {it.keys && <kbd>{it.keys}</kbd>}
            </button>
          ),
        )}
      </div>
      {sub && <MenuBox items={sub.items} x={sub.x} y={sub.y} onClose={onClose} />}
    </>
  );
}

/** Opens a menu at a point (the pointer for right-click, or under a button). `head` goes on top inside it. */
/** `gone`: called once the menu is gone, however it went (a pick, Escape, a click outside, another menu). */
export function openMenu(items: MenuItem[], x: number, y: number, opts: { cls?: string; above?: boolean; head?: ReactNode; gone?: () => void } = {}) {
  const box = <MenuBox items={items} x={x} y={y} cls={opts.cls} above={opts.above} head={opts.head} onClose={() => closeLayer(id)} />;
  const id: number = openLayer(opts.gone ? <WhenGone gone={opts.gone}>{box}</WhenGone> : box);
  return id;
}

function WhenGone({ gone, children }: { gone: () => void; children: ReactNode }) {
  useEffect(() => gone, [gone]);
  return <>{children}</>;
}

// ---- Dialogs ----

export function Dialog({ title, children, buttons, onClose, wide }: { title?: string; children?: ReactNode; buttons: { label: string; fill?: boolean; red?: boolean; disabled?: boolean; run?: () => void }[]; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className={`dialog pop ${wide ? 'wide' : ''}`} role="dialog" aria-modal>
      {title && <h3>{title}</h3>}
      {children}
      <div className="btns">
        {buttons.map((b) => (
          <button
            key={b.label}
            className={`btn ${b.fill ? 'fill' : 'ghost'} ${b.red ? 'red' : ''}`}
            disabled={b.disabled}
            onClick={() => {
              // The button's answer first: closing answers "no" to anything still waiting.
              b.run?.();
              onClose();
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Delete chat?" with Cancel and a red or blue button. Resolves true when confirmed. */
export function confirm(title: string, body: string, yes: string, red = false): Promise<boolean> {
  return new Promise((resolve) => {
    const id: number = openLayer(
      <Dialog
        title={title}
        onClose={() => {
          closeLayer(id);
          resolve(false);
        }}
        buttons={[
          { label: 'Cancel' },
          {
            label: yes,
            fill: true,
            red,
            run: () => resolve(true),
          },
        ]}
      >
        {body && <p className="dtext">{body}</p>}
      </Dialog>,
      true,
    );
  });
}

/** A dialog of choices (Mute: 8 hours, 1 week, Always). Resolves with the one picked, or null. */
export function choose<T extends string>(title: string, options: { value: T; label: string }[], current: T, ok = 'OK'): Promise<T | null> {
  return new Promise((resolve) => {
    function Choices() {
      const [v, setV] = useState(current);
      return (
        <Dialog
          title={title}
          onClose={() => {
            closeLayer(id);
            resolve(null);
          }}
          buttons={[{ label: 'Cancel', run: () => resolve(null) }, { label: ok, fill: true, run: () => resolve(v) }]}
        >
          {options.map((o) => (
            <button key={o.value} className={`radio ${v === o.value ? 'on' : ''}`} onClick={() => setV(o.value)}>
              <i />
              {o.label}
            </button>
          ))}
        </Dialog>
      );
    }
    const id: number = openLayer(<Choices />, true);
  });
}

/** A dialog with one line to type in ("New list"). Resolves with the words, or null. */
export function askText(title: string, placeholder: string, ok = 'Save', max = 40, opts: { initial?: string; long?: boolean; empty?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    function Ask() {
      const [v, setV] = useState(opts.initial ?? '');
      if (opts.long) {
        // Several lines (a group's description): Enter is a new line, and it may be left empty.
        return (
          <Dialog
            title={title}
            onClose={() => {
              closeLayer(id);
              resolve(null);
            }}
            buttons={[{ label: 'Cancel' }, { label: ok, fill: true, run: () => resolve(v.trim()) }]}
          >
            <textarea className="dinput long" autoFocus maxLength={max} placeholder={placeholder} value={v} rows={5} onChange={(e) => setV(e.target.value)} />
          </Dialog>
        );
      }
      return (
        <Dialog
          title={title}
          onClose={() => {
            closeLayer(id);
            resolve(null);
          }}
          buttons={[{ label: 'Cancel' }, { label: ok, fill: true, run: () => resolve(v.trim() || null) }]}
        >
          <input
            className="dinput"
            autoFocus
            maxLength={max}
            placeholder={placeholder}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && v.trim()) {
                resolve(v.trim());
                closeLayer(id);
              }
            }}
          />
        </Dialog>
      );
    }
    const id: number = openLayer(<Ask />, true);
  });
}
