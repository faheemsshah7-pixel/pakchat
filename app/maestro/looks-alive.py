"""Checks a phone screenshot really shows something.

Maestro finds buttons by asking Android what's on screen, and Android lists a
button even if it's drawn invisible (no colours, faded out). That's how a
blank black sign-in screen once passed. So this looks at the picture itself:
a real screen has many colours; a blank one has a handful.

Usage: python3 looks-alive.py screenshot.png
Only needs Python itself (it reads the PNG by hand), so it runs on any Mac.
"""
import struct
import sys
import zlib


def pixels(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos, idat = 8, b''
    while pos < len(data):
        size, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + size]
        if kind == b'IHDR':
            width, height, depth, colour = struct.unpack('>IIBB', body[:10])
        elif kind == b'IDAT':
            idat += body
        pos += 12 + size
    assert depth == 8 and colour in (2, 6), 'expected an 8-bit RGB or RGBA screenshot'
    bpp = 4 if colour == 6 else 3
    raw = zlib.decompress(idat)
    stride = width * bpp
    rows, prev = [], bytearray(stride)
    for y in range(height):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        # Undo PNG's per-row filters (none, sub, up, average, Paeth).
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return width, height, bpp, rows


def main():
    width, height, bpp, rows = pixels(sys.argv[1])
    colours = set()
    # Skip the status bar at the top and the gesture bar at the bottom.
    for y in range(height // 10, height * 9 // 10, 4):
        row = rows[y]
        for x in range(0, width, 4):
            colours.add(row[x * bpp:x * bpp + 3])
    print(f'{len(colours)} colours on screen')
    if len(colours) < 40:
        print('The screen looks blank: the app is not drawing properly.')
        sys.exit(1)


main()
