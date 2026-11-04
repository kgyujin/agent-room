"""App icon + menu bar icon (pixel art, generated; run `python3 gen_icon.py`, then `npx tauri icon`).

App icon: drawn on a 64x64 pixel grid (one colour per pixel) and scaled x16 to 1024 with
nearest-neighbour, so every art pixel stays a solid 16x16 block. Layout follows the macOS
icon grid (rounded tile ~52/64 wide, centred).
Menu bar icon: 18x18 monochrome template (black + alpha), exported at @2x.
"""
import os
from PIL import Image
from pix import Spr, Iso, hexc, shade

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'src-tauri', 'icons')

SKY = ['#8fd3ea', '#a6dcef', '#bfe5f2', '#d6ecf3', '#ecebf2', '#f8e2ea']


def tile(s, x0, y0, size, r):
    """pixel rounded square with banded sky"""
    band = size / len(SKY)
    for y in range(size):
        for x in range(size):
            cx = min(x, size - 1 - x)
            cy = min(y, size - 1 - y)
            if cx < r and cy < r and (r - cx - 0.5) ** 2 + (r - cy - 0.5) ** 2 > r * r:
                continue
            s.put(x0 + x, y0 + y, hexc(SKY[min(len(SKY) - 1, int(y / band))]))


def room(s, ox, oy):
    iso = Iso(ox, oy)
    P = iso.p
    n, wh = 9, 13
    wall, wall_r, cap = hexc('#f4d9cf'), hexc('#e9c2b8'), hexc('#fbe9df')
    wood, wood_d, plank = hexc('#a8693f'), hexc('#7a4b35'), hexc('#c99467')
    plinth, plinth_d = hexc('#fbe9df'), hexc('#e8c9ae')
    iso.box(s, -1, -1, -2, n + 1, n + 1, 2, cap, plinth, plinth_d, rim=False)
    iso.box(s, 0, 0, 0, n, n, 1, plank, wood, wood_d, rim=False)
    iso.box(s, -1, -1, 0, 1, n + 1, wh, cap, wood, wall, rim=False)          # left wall
    iso.box(s, -1, -1, 0, n + 1, 1, wh, cap, wall_r, wood_d, rim=False)      # right wall
    # window on the left wall (sky)
    s.poly([P(0, 4, 11), P(0, 7, 11), P(0, 7, 6), P(0, 4, 6)], hexc('#bfe5f2'))
    s.poly([P(0, 5.5, 11), P(0, 6, 11), P(0, 6, 6), P(0, 5.5, 6)], cap)
    # desk + glowing monitor against the right wall
    iso.box(s, 4, 0, 1, 5, 2, 4, hexc('#e2b07a'), hexc('#c98d58'), wood)
    iso.box(s, 5, 0, 5, 3, 1, 4, hexc('#c3c9d8'), hexc('#9aa1b5'), hexc('#757b91'), rim=False)
    s.poly([P(5.5, 1, 8.5), P(7.5, 1, 8.5), P(7.5, 1, 5.5), P(5.5, 1, 5.5)], hexc('#9fe0d8'))
    # rug + pink armchair
    s.poly([P(3, 4, 1), P(8, 4, 1), P(8, 8, 1), P(3, 8, 1)], hexc('#f6c8c0'))
    iso.box(s, 1, 5, 1, 3, 3, 3, hexc('#f7a8bf'), hexc('#e8889f'), hexc('#c86d85'), rim=False)
    iso.box(s, 1, 5, 4, 1, 3, 3, hexc('#f7a8bf'), hexc('#e8889f'), hexc('#c86d85'), rim=False)


def app_icon():
    s = Spr(64, 64)
    tile(s, 6, 6, 52, 12)
    r = Spr(64, 64)
    room(r, 32, 20)
    r.outline(color=hexc('#5a3a40'))
    s.paste(r, 0, 6)
    return s


def tray_icon():
    """18x18 template glyph: two filled back walls (window cut in the left one) over a floor
    diamond, separated by a 1px gap. Only alpha matters on macOS."""
    s = Spr(18, 18)
    ink = (0, 0, 0, 255)
    for x in range(1, 17):
        d = int(abs(x - 8.5) - 0.5)
        top = 1 + d // 2
        for y in range(top, top + 8):
            s.put(x, y, ink)
        for y in range(top + 9, 17 - d // 2):
            s.put(x, y, ink)
    for y in range(2, 9):                      # back corner seam between the two walls
        s.px[8, y] = (0, 0, 0, 0)
    for (x, y) in ((4, 6), (5, 6), (4, 7), (5, 7), (4, 8), (5, 8)):
        s.px[x, y] = (0, 0, 0, 0)
    return s


def main():
    os.makedirs(OUT, exist_ok=True)
    a = app_icon()
    a.im.resize((1024, 1024), Image.NEAREST).save(os.path.join(OUT, 'source.png'))
    t = tray_icon()
    t.im.resize((36, 36), Image.NEAREST).save(os.path.join(OUT, 'tray.png'))
    print('icons written')


if __name__ == '__main__':
    main()
