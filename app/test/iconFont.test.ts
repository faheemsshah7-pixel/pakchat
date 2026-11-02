// The icon fonts (scripts/make-icon-font.py) have to be made again when an icon is added or
// changed in icons.tsx; this notices when they weren't.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ICON_FONTS, ICON_LETTERS } from '../src/ui/iconFont';

const src = readFileSync(join(__dirname, '../src/ui/icons.tsx'), 'utf8');
const a = src.indexOf('const ICONS = ') + 'const ICONS = '.length;
const b = src.indexOf('} satisfies Record<string, Shape>');
const ICONS = Function(`return (${src.slice(a, b + 1)})`)() as Record<string, unknown>;

describe('icon fonts', () => {
  it('have a letter for every icon, in order', () => {
    expect(Object.keys(ICON_LETTERS)).toEqual(Object.keys(ICONS));
    Object.values(ICON_LETTERS).forEach((l, i) => expect(l.codePointAt(0)).toBe(0xe000 + i));
  });

  it('were made from the icons as they are now', () => {
    // The script writes a fingerprint of the icons into iconFont.ts.
    const made = readFileSync(join(__dirname, '../src/ui/iconFont.ts'), 'utf8').match(/from icons: ([0-9a-f]+)/)?.[1];
    const now = createHash('sha256').update(JSON.stringify(Object.entries(ICONS))).digest('hex').slice(0, 16);
    expect(made).toBe(now);
  });

  it('are all in the app', () => {
    const app = readFileSync(join(__dirname, '../app.json'), 'utf8');
    for (const [, family] of ICON_FONTS) expect(app).toContain(`./assets/fonts/icons/${family}.ttf`);
  });
});
