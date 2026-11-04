"""App icon + menu bar icon (pixel art, generated; run `python3 gen_icon.py`, then `npx tauri icon`).

App icon: a small house drawn on a 64x64 pixel grid (one colour per pixel) and scaled x16 to 1024 with
nearest-neighbour, so every art pixel stays a solid 16x16 block. Layout follows the macOS
icon grid (rounded tile ~52/64 wide, centred).
Menu bar icon: 18x18 monochrome template (black + alpha), exported at @2x.
"""
import os
from PIL import Image
from pix import Spr, hexc

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


def house(s):
    """small handheld-RPG style house: red hip roof, cream walls, door and window, on grass"""
    roof, roof_d, roof_l = hexc('#e2574c'), hexc('#b8433b'), hexc('#f58a7a')
    wall, wall_d = hexc('#fff3dc'), hexc('#e8d3b2')
    wood, wood_d = hexc('#b8794a'), hexc('#8a5a3a')
    glass, glass_l = hexc('#8fd0ee'), hexc('#d8f0f8')
    grass, grass_d = hexc('#8ccf6e'), hexc('#6db25a')
    # grass strip
    s.rect(10, 46, 44, 10, grass)
    for x in range(12, 52, 5):
        s.put(x, 47 + (x % 3), grass_d)
    # walls
    s.rect(16, 30, 32, 18, wall)
    s.rect(16, 46, 32, 2, wall_d)
    s.rect(46, 30, 2, 18, wall_d)
    # roof (trapezoid with eave) and shingle rows
    for i, y in enumerate(range(16, 31)):
        x0 = 20 - i // 2 - 2
        x1 = 44 + i // 2 + 2
        s.rect(x0, y, x1 - x0, 1, roof_l if i < 2 else (roof_d if y % 4 == 3 else roof))
    s.rect(11, 31, 42, 1, roof_d)
    # chimney
    s.rect(38, 11, 5, 7, hexc('#c9a27a')); s.rect(38, 11, 5, 1, hexc('#e2c39c'))
    # door
    s.rect(28, 37, 8, 11, wood); s.rect(28, 37, 8, 1, wood_d); s.put(34, 43, hexc('#f6d06a'))
    s.rect(26, 48, 12, 2, hexc('#c9b9a0'))
    # windows
    for wx in (19, 39):
        s.rect(wx, 35, 6, 6, glass); s.rect(wx, 35, 3, 2, glass_l)
        s.rect(wx + 2, 35, 1, 6, wall); s.rect(wx, 37, 6, 1, wall)
        s.rect(wx - 1, 41, 8, 1, wood)


def app_icon():
    s = Spr(64, 64)
    tile(s, 6, 6, 52, 12)
    r = Spr(64, 64)
    house(r)
    r.outline(color=hexc('#3b2a2e'))
    s.paste(r, 0, 2)
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
