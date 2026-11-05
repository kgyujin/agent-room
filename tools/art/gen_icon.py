"""App icon + menu bar icon (pixel art, generated; run `python3 gen_icon.py`, then `npx tauri icon`).

App icon: the office corner with the shiba pet, drawn on a 64x64 pixel grid (one colour per pixel) and scaled x16 to 1024 with
nearest-neighbour, so every art pixel stays a solid 16x16 block. Layout follows the macOS
icon grid (rounded tile ~52/64 wide, centred).
Menu bar icon: 18x18 monochrome template (black + alpha), exported at @2x.
"""
import os
from PIL import Image
from pix import Spr, hexc

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'src-tauri', 'icons')

CRIT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'public', 'assets', 'critters', 'shiba.png')


def in_tile(x, y, x0=6, y0=6, size=52, r=12):
    """pixel rounded square (the macOS icon grid: ~52/64 wide, centred)"""
    x, y = x - x0, y - y0
    if not (0 <= x < size and 0 <= y < size):
        return False
    cx, cy = min(x, size - 1 - x), min(y, size - 1 - y)
    return not (cx < r and cy < r and (r - cx - 0.5) ** 2 + (r - cy - 0.5) ** 2 > r * r)


def room(s):
    """the app's own room in miniature: a corner of the office (two walls, wooden floor, a window)
    with the shiba pet in front"""
    c = lambda h: hexc(h)
    sky, sky_l = c('#a9d4f2'), c('#d8eefb')
    wall_l, wall_r, wall_top = c('#f1e3c9'), c('#e6d2b2'), c('#fbf3e3')
    wood, wood_d, wood_ln = c('#b07444'), c('#87532f'), c('#5f3a22')
    fl = [c('#e8b97f'), c('#dcaa70'), c('#efc690'), c('#d19d63')]
    cx = 32
    for y in range(64):
        for x in range(64):
            if not in_tile(x, y):
                continue
            d = abs(x + 0.5 - cx)                 # distance from the back corner
            wall_bot = 30 + d / 2                 # where wall meets floor (2:1 iso)
            wall_top_y = 12 + d / 2
            if y < wall_top_y:
                s.put(x, y, sky_l if y < 9 else sky)
            elif y < wall_top_y + 1:
                s.put(x, y, wall_top)
            elif y < wall_bot - 4:
                s.put(x, y, wall_l if x < cx else wall_r)
            elif y < wall_bot - 3:
                s.put(x, y, wood_d)               # wainscot rail
            elif y < wall_bot:
                s.put(x, y, wood if x < cx else wood_d)
            else:
                # planks run along the right wall: rows by (y - x/2)
                # planks run parallel to the right wall: 4px rows in two tones with a thin seam
                u = int(y - x / 2 + 64)
                row = u // 4
                s.put(x, y, fl[3] if u % 4 == 0 else fl[row % 2 * 2])
    # back corner seam
    for y in range(13, 30):
        s.put(cx, y, c('#d9c19c'))
    # window on the left wall (sky behind, cross frame)
    for i in range(10):
        x = 13 + i
        top = 15 + int((cx - x) / 2)
        for y in range(top, top + 8):
            s.put(x, y, sky_l if (y - top) < 3 else sky)
        s.put(x, top - 1, wood_d); s.put(x, top + 8, wood_d); s.put(x, top + 4, wood_d)
    for x in (12, 17, 23):
        top = 15 + int((cx - x) / 2)
        for y in range(top - 1, top + 9):
            s.put(x, y, wood_d)
    # a little frame on the right wall
    for i in range(7):
        x = 40 + i
        top = 17 + int((x - cx) / 2)
        for y in range(top, top + 6):
            edge = i in (0, 6) or y in (top, top + 5)
            s.put(x, y, wood if edge else c('#f4c98a'))


def app_icon():
    s = Spr(64, 64)
    room(s)
    pet = Image.open(CRIT).convert('RGBA').crop((0, 0, 25, 27))
    px = pet.load()
    # soft contact shadow, then the pet (frame 0, facing left-front) a little left of centre
    ox, oy = 19, 27
    for x in range(ox + 2, ox + 24):
        for y in (oy + 25, oy + 26) if ox + 4 <= x < ox + 22 else (oy + 25,):
            if in_tile(x, y):
                r, g, b, a = s.get(x, y)
                s.px[x, y] = (int(r * 0.72), int(g * 0.68), int(b * 0.66), 255)
    for y in range(27):
        for x in range(25):
            if px[x, y][3] == 255 and in_tile(ox + x, oy + y):
                s.px[ox + x, oy + y] = px[x, y]
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
