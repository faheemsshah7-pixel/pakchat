# make-stickers.py: draws PakChat's built-in sticker pack.
#
# Each sticker is a 512 x 512 WebP with a see-through background (what
# WhatsApp uses too): a word in Urdu, its English spelling under it, on a
# coloured badge with a thick white edge and a soft shadow, so it looks like
# a real sticker cut out of paper.
#
# Run it again after changing the list (it needs Python's Pillow, built with
# "raqm" so Urdu letters join up):
#   python3 scripts/make-stickers.py
# The pictures go to assets/stickers/, and src/core/stickerPack.ts lists them.
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / 'assets' / 'stickers'
URDU_FONT = HERE / 'node_modules/@expo-google-fonts/noto-nastaliq-urdu/700Bold/NotoNastaliqUrdu_700Bold.ttf'
LATIN_FONT = Path('/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf')

# name, Urdu, English, two colours for the badge (top, bottom)
STICKERS = [
    ('salam', 'السلام علیکم', 'Assalam o Alaikum', '#16A34A', '#0D9488'),
    ('shukriya', 'شکریہ', 'Shukriya', '#DB2777', '#9333EA'),
    ('jazakallah', 'جزاک اللہ', 'JazakAllah', '#0891B2', '#2F6BF0'),
    ('inshallah', 'ان شاء اللہ', 'InshaAllah', '#7C3AED', '#4F46E5'),
    ('mashallah', 'ماشاء اللہ', 'MashaAllah', '#EA580C', '#E11D48'),
    ('eid', 'عید مبارک', 'Eid Mubarak', '#B45309', '#16A34A'),
    ('ameen', 'آمین', 'Ameen', '#0D9488', '#0891B2'),
    ('wah', 'واہ!', 'Wah!', '#E11D48', '#EA580C'),
    ('theek', 'ٹھیک ہے', 'Theek hai', '#2F6BF0', '#7C3AED'),
    ('ji', 'جی', 'Ji', '#16A34A', '#2F6BF0'),
    ('kamaal', 'کمال!', 'Kamaal!', '#9333EA', '#DB2777'),
    ('hahaha', 'ہاہاہا', 'Hahaha', '#EA580C', '#B45309'),
    ('chai', 'چائے؟', 'Chai?', '#92400E', '#B45309'),
    ('mubarak', 'مبارک ہو', 'Mubarak ho', '#DB2777', '#EA580C'),
    ('birthday', 'سالگرہ مبارک', 'Happy Birthday', '#4F46E5', '#DB2777'),
    ('allahhafiz', 'اللہ حافظ', 'Allah Hafiz', '#334155', '#0891B2'),
]

SIZE = 512
# Drawn twice as big and shrunk at the end, for smooth edges.
BIG = SIZE * 2


def rgb(hex_colour):
    return tuple(int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))


def fit(text, path, start, width, **kw):
    """The biggest font size (from `start` down) at which `text` fits in `width`."""
    size = start
    while size > 20:
        font = ImageFont.truetype(str(path), size, **kw)
        box = font.getbbox(text, **({'direction': 'rtl', 'language': 'ur'} if kw.get('layout_engine') else {}))
        if box[2] - box[0] <= width:
            return font, box
        size -= 8
    return font, box


def draw(urdu, english, top, bottom):
    pad = 70
    box = (pad, pad + 40, BIG - pad, BIG - pad - 40)

    # The badge's shape, used for the white edge, the shadow and the colour.
    shape = Image.new('L', (BIG, BIG), 0)
    ImageDraw.Draw(shape).rounded_rectangle(box, radius=170, fill=255)

    # A thick white border all round: the same shape, 22 px bigger on every side.
    edge = Image.new('L', (BIG, BIG), 0)
    ImageDraw.Draw(edge).rounded_rectangle((box[0] - 22, box[1] - 22, box[2] + 22, box[3] + 22), radius=192, fill=255)
    shadow = edge.filter(ImageFilter.GaussianBlur(22))

    out = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    shade = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 90))
    out.paste(shade, (0, 16), shadow)
    out.paste(Image.new('RGBA', (BIG, BIG), (255, 255, 255, 255)), (0, 0), edge)

    # The colour, from `top` to `bottom`.
    a, b = rgb(top), rgb(bottom)
    column = Image.new('RGBA', (1, BIG))
    for y in range(BIG):
        t = y / (BIG - 1)
        column.putpixel((0, y), tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,))
    fade = column.resize((BIG, BIG))
    out.paste(fade, (0, 0), shape)

    pen = ImageDraw.Draw(out)
    inner = box[2] - box[0] - 120
    # Urdu, big, joined up properly (raqm), right to left.
    ufont, ubox = fit(urdu, URDU_FONT, 230, inner, layout_engine=ImageFont.Layout.RAQM)
    efont, ebox = fit(english, LATIN_FONT, 96, inner)
    uh = ubox[3] - ubox[1]
    eh = ebox[3] - ebox[1]
    gap = 34
    y0 = (box[1] + box[3]) / 2 - (uh + gap + eh) / 2
    ux = BIG / 2 - (ubox[0] + ubox[2]) / 2
    pen.text((ux, y0 - ubox[1]), urdu, font=ufont, fill='white', direction='rtl', language='ur', stroke_width=6, stroke_fill=(0, 0, 0, 40))
    ex = BIG / 2 - (ebox[0] + ebox[2]) / 2
    pen.text((ex, y0 + uh + gap - ebox[1]), english, font=efont, fill=(255, 255, 255, 235))

    return out.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, urdu, english, top, bottom in STICKERS:
        draw(urdu, english, top, bottom).save(OUT / f'{name}.webp', 'WEBP', quality=88, method=6)
        print('made', name)


if __name__ == '__main__':
    main()
