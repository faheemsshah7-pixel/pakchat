// reuse.ts: keeps what hasn't changed.
//
// The database hands back new copies of everything each time it's read. A
// message or chat that's the same as last time keeps its old copy here, so
// React can tell nothing changed and leaves it alone: when a tick turns blue,
// only that one bubble is drawn again, not every bubble on the screen.

/** True when two values read from the database (plain JSON) hold the same thing. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const list = b as unknown[];
    if (a.length !== list.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], list[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) if (!(k in y) || !same(x[k], y[k])) return false;
  return true;
}

/**
 * `fresh`, with each item that's the same as one in `old` (matched by `key`)
 * swapped for the old one. When nothing at all changed, `old` itself comes back.
 */
export function reuse<T>(old: readonly T[] | null | undefined, fresh: T[], key: (x: T) => string): T[] {
  if (!old?.length) return fresh;
  const before = new Map(old.map((x) => [key(x), x]));
  let changed = old.length !== fresh.length;
  const out = fresh.map((x, i) => {
    const was = before.get(key(x));
    if (was !== undefined && same(was, x)) {
      if (old[i] !== was) changed = true;
      return was;
    }
    changed = true;
    return x;
  });
  return changed ? out : (old as T[]);
}
