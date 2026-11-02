#!/usr/bin/env python3
"""make-icon-font.py: turns every icon in src/ui/icons.tsx into fonts the phone draws natively.

Drawing each icon as an SVG made every screen slow to open on low-end phones (each one is a
little vector picture with its own views). A letter in a font is drawn by Android itself,
at once and from its own cache, like WhatsApp's icons. The lines keep their exact shapes:
each one is outlined at the line width it's drawn with (one font per width the app uses),
with round ends and corners, as in the SVG.

Run it again after adding or changing an icon:
  python3 -m venv /tmp/iconvenv && /tmp/iconvenv/bin/pip install fonttools skia-python
  /tmp/iconvenv/bin/python scripts/make-icon-font.py
It writes assets/fonts/icons/PakIcons<width>.ttf and src/ui/iconFont.ts.
"""
import json
import math
import os
import re
import subprocess
import sys

import skia
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
SCALE = 100  # 24 units across, as 2400 font units
EM = 24 * SCALE
FIRST = 0xE000  # private use letters, which no text ever has
# Line widths for icons (`stroke` on <Icon>, 1.9 by default); others use the nearest (a tenth
# of a unit thinner or thicker can't be seen), so the phone loads only a few small fonts.
WIDTHS = [1.6, 1.9, 2.2, 2.4, 2.6, 3]


def icons():
    """ICONS from icons.tsx, in its order (read with node, so nothing is copied by hand), and a
    fingerprint of them (test/iconFont.test.ts checks the fonts were made from the icons as they are)."""
    js = r"""
const src = require('fs').readFileSync(process.argv[1], 'utf8');
const a = src.indexOf('const ICONS = ') + 'const ICONS = '.length;
const b = src.indexOf('} satisfies Record<string, Shape>');
const obj = Function('return (' + src.slice(a, b + 1) + ')')();
const entries = JSON.stringify(Object.entries(obj));
const print = require('crypto').createHash('sha256').update(entries).digest('hex').slice(0, 16);
process.stdout.write(JSON.stringify({ entries: JSON.parse(entries), print }));
"""
    out = subprocess.check_output(['node', '-e', js, os.path.join(APP, 'src/ui/icons.tsx')])
    got = json.loads(out)
    return got['entries'], got['print']


NUM = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')


def parse_d(d, path):
    """An SVG path's `d` into a skia path (M L H V C S Q T A Z, either case)."""
    tokens = re.findall(r'[MLHVCSQTAZmlhvcsqtaz]|' + NUM.pattern, d)
    i = 0
    cmd = None
    x = y = sx = sy = 0.0
    last_c = None  # last cubic control (for S)
    last_q = None  # last quad control (for T)

    def num():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        t = tokens[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t
            i += 1
            if cmd in 'Zz':
                path.close()
                x, y = sx, sy
                last_c = last_q = None
                continue
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = (x, y) if rel else (0.0, 0.0)
        if c == 'M':
            x, y = ox + num(), oy + num()
            path.moveTo(x, y)
            sx, sy = x, y
            cmd = 'l' if rel else 'L'  # more pairs after M are lines
            last_c = last_q = None
        elif c == 'L':
            x, y = ox + num(), oy + num()
            path.lineTo(x, y)
            last_c = last_q = None
        elif c == 'H':
            x = (x if rel else 0) + num()
            path.lineTo(x, y)
            last_c = last_q = None
        elif c == 'V':
            y = (y if rel else 0) + num()
            path.lineTo(x, y)
            last_c = last_q = None
        elif c == 'C':
            x1, y1, x2, y2 = ox + num(), oy + num(), ox + num(), oy + num()
            x, y = ox + num(), oy + num()
            path.cubicTo(x1, y1, x2, y2, x, y)
            last_c, last_q = (x2, y2), None
        elif c == 'S':
            x1, y1 = (2 * x - last_c[0], 2 * y - last_c[1]) if last_c else (x, y)
            x2, y2 = ox + num(), oy + num()
            x, y = ox + num(), oy + num()
            path.cubicTo(x1, y1, x2, y2, x, y)
            last_c, last_q = (x2, y2), None
        elif c == 'Q':
            x1, y1 = ox + num(), oy + num()
            x, y = ox + num(), oy + num()
            path.quadTo(x1, y1, x, y)
            last_q, last_c = (x1, y1), None
        elif c == 'T':
            x1, y1 = (2 * x - last_q[0], 2 * y - last_q[1]) if last_q else (x, y)
            x, y = ox + num(), oy + num()
            path.quadTo(x1, y1, x, y)
            last_q, last_c = (x1, y1), None
        elif c == 'A':
            rx, ry, rot, large, sweep = num(), num(), num(), num(), num()
            x, y = ox + num(), oy + num()
            path.arcTo(
                rx, ry, rot,
                skia.Path.ArcSize.kLarge_ArcSize if large else skia.Path.ArcSize.kSmall_ArcSize,
                skia.PathDirection.kCW if sweep else skia.PathDirection.kCCW,
                x, y,
            )
            last_c = last_q = None
        else:
            raise ValueError(f'unknown path command {cmd} in {d}')


def stroked(src, width, dash=None, cap=skia.Paint.kRound_Cap):
    paint = skia.Paint(
        Style=skia.Paint.kStroke_Style,
        StrokeWidth=width * SCALE,
        StrokeCap=cap,
        StrokeJoin=skia.Paint.kRound_Join,
    )
    if dash:
        paint.setPathEffect(skia.DashPathEffect.Make([v * SCALE for v in dash], 0))
    out = skia.Path()
    paint.getFillPath(src, out, None, 4)
    return out


def scaled(path):
    p = skia.Path(path)
    p.transform(skia.Matrix.Scale(SCALE, SCALE))
    return p


def outline(shape, width):
    """One icon at one line width, as filled outlines (as icons.tsx's IconPaths draws it)."""
    parts = []
    for d in shape.get('d', []):
        p = skia.Path()
        parse_d(d, p)
        parts.append(stroked(scaled(p), width))
    for d in shape.get('fill', []):
        p = skia.Path()
        parse_d(d, p)
        p = scaled(p)
        parts.append(p)
        parts.append(stroked(p, 1))  # its 1-wide rounded edge
    for cx, cy, r in shape.get('circles', []):
        p = skia.Path()
        p.addCircle(cx * SCALE, cy * SCALE, r * SCALE)
        parts.append(stroked(p, width))
    for cx, cy, r in shape.get('dots', []):
        p = skia.Path()
        p.addCircle(cx * SCALE, cy * SCALE, r * SCALE)
        parts.append(p)
    for x, y, w, h, rx in shape.get('rects', []):
        p = skia.Path()
        p.addRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(x * SCALE, y * SCALE, w * SCALE, h * SCALE), rx * SCALE, rx * SCALE))
        parts.append(stroked(p, width))
    return parts


def union(parts):
    # One by one (skia's OpBuilder lost the hole of a lone ring, like the star's).
    out = skia.Simplify(parts[0])
    for p in parts[1:]:
        out = skia.Op(out, p, skia.PathOp.kUnion_PathOp)
    return winding(out)


def contours(path):
    """A path's separate closed shapes, each as its own path, with its points (for its turn)."""
    out = []
    cur = pts = None
    it = skia.Path.Iter(path, False)
    while True:
        verb, p = it.next()
        if verb == skia.Path.Verb.kDone_Verb:
            break
        if verb == skia.Path.Verb.kMove_Verb:
            cur, pts = skia.Path(), [p[0]]
            out.append((cur, pts))
            cur.moveTo(p[0])
        elif verb == skia.Path.Verb.kLine_Verb:
            cur.lineTo(p[1])
            pts.append(p[1])
        elif verb == skia.Path.Verb.kQuad_Verb:
            cur.quadTo(p[1], p[2])
            pts.extend(p[1:])
        elif verb == skia.Path.Verb.kConic_Verb:
            cur.conicTo(p[1], p[2], it.conicWeight())
            pts.extend(p[1:])
        elif verb == skia.Path.Verb.kCubic_Verb:
            cur.cubicTo(p[1], p[2], p[3])
            pts.extend(p[1:])
        elif verb == skia.Path.Verb.kClose_Verb:
            cur.close()
    return out


def winding(path):
    """Fonts fill by winding, so each shape inside another (a ring's hole, a dot in a hole) has to
    run the other way round to it. The joined shapes never cross, so how deep each one sits
    (how many others it's inside) says which way it should run."""
    shapes = contours(path)
    out = skia.Path()
    for i, (c, pts) in enumerate(shapes):
        depth = sum(1 for j, (o, _) in enumerate(shapes) if j != i and o.contains(pts[0].x(), pts[0].y()))
        area = sum(a.x() * b.y() - b.x() * a.y() for a, b in zip(pts, pts[1:] + pts[:1]))
        clockwise = area > 0  # (y points down)
        if clockwise == (depth % 2 == 0):
            out.addPath(c)
        else:
            out.reverseAddPath(c)
    return out


def glyph(path):
    """A skia path (y down, 2400 across) into a TrueType letter (y up)."""
    tt = TTGlyphPen(None)
    pen = Cu2QuPen(tt, max_err=1.0, reverse_direction=True)

    def pt(p):
        return (p.x(), EM - p.y())

    it = skia.Path.Iter(path, False)
    open_ = False
    while True:
        verb, pts = it.next()
        if verb == skia.Path.Verb.kDone_Verb:
            break
        if verb == skia.Path.Verb.kMove_Verb:
            if open_:
                pen.closePath()
            pen.moveTo(pt(pts[0]))
            open_ = True
        elif verb == skia.Path.Verb.kLine_Verb:
            pen.lineTo(pt(pts[1]))
        elif verb == skia.Path.Verb.kQuad_Verb:
            pen.qCurveTo(pt(pts[1]), pt(pts[2]))
        elif verb == skia.Path.Verb.kConic_Verb:
            q = skia.Path.ConvertConicToQuads(pts[0], pts[1], pts[2], it.conicWeight(), 2)
            for k in range(1, len(q) - 1, 2):
                pen.qCurveTo(pt(q[k]), pt(q[k + 1]))
        elif verb == skia.Path.Verb.kCubic_Verb:
            pen.curveTo(pt(pts[1]), pt(pts[2]), pt(pts[3]))
        elif verb == skia.Path.Verb.kClose_Verb:
            pen.closePath()
            open_ = False
    if open_:
        pen.closePath()
    return tt.glyph()


def build(entries, width):
    name = f'PakIcons{round(width * 10):02d}'
    order = ['.notdef'] + [n for n, _ in entries]
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    for n, shape in entries:
        parts = outline(shape, width)
        if n == 'status':  # the dashed ring around it, starting at the right and going round clockwise
            ring = skia.Path()
            ring.addOval(skia.Rect.MakeLTRB((12 - 8.5) * SCALE, (12 - 8.5) * SCALE, (12 + 8.5) * SCALE, (12 + 8.5) * SCALE), skia.PathDirection.kCW, 1)
            parts.append(stroked(ring, width, dash=[4, 3], cap=skia.Paint.kButt_Cap))  # (square ends, as in the SVG)
        glyphs[n] = glyph(union(parts)) if parts else TTGlyphPen(None).glyph()
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({FIRST + i: n for i, (n, _) in enumerate(entries)})
    fb.setupGlyf(glyphs)
    glyf = fb.font['glyf']
    lsb = {}
    for g in order:
        glyf[g].recalcBounds(glyf)
        lsb[g] = getattr(glyf[g], 'xMin', 0)
    fb.setupHorizontalMetrics({g: (EM, lsb[g]) for g in order})
    # The letter box is exactly the 24×24 icon box: from the top of the line to its bottom.
    fb.setupHorizontalHeader(ascent=EM, descent=0, lineGap=0)
    fb.setupNameTable({'familyName': name, 'styleName': 'Regular'})
    fb.setupOS2(version=4, sTypoAscender=EM, sTypoDescender=0, sTypoLineGap=0, usWinAscent=EM, usWinDescent=0, fsSelection=0x40 | 0x80)
    fb.setupPost()
    out = os.path.join(APP, 'assets/fonts/icons', name + '.ttf')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fb.save(out)
    return name


def main():
    entries, print_ = icons()
    names = [build(entries, w) for w in WIDTHS]
    codes = {n: FIRST + i for i, (n, _) in enumerate(entries)}
    ts = [
        '// iconFont.ts: made by scripts/make-icon-font.py from icons.tsx (run it again after changing an icon).',
        f'// Made from icons: {print_}',
        '// Each icon is a letter in a font, one font per line width, so Android draws it natively.',
        '',
        '/** The fonts, by line width. */',
        'export const ICON_FONTS: readonly (readonly [number, string])[] = [',
        *[f"  [{w}, '{n}']," for w, n in zip(WIDTHS, names)],
        '];',
        '',
        '/** Each icon\'s letter. */',
        'export const ICON_LETTERS: Record<string, string> = {',
        *[f"  {n}: '\\u{c:04X}'," for n, c in codes.items()],
        '};',
        '',
    ]
    with open(os.path.join(APP, 'src/ui/iconFont.ts'), 'w') as f:
        f.write('\n'.join(ts))
    print(f'{len(entries)} icons, {len(names)} fonts')


if __name__ == '__main__':
    sys.exit(main())
