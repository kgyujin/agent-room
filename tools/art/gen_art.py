"""Generates every pixel-art asset for Agent Room (deterministic; run `python3 gen_art.py`).

Outputs to app/public/assets/:
  atlas.png / atlas.json   - all sprites + scene layout (furniture boxes, spots, overlay positions)
"""
import json
import math
import os
import random

from PIL import Image

from pix import Spr, Iso, hexc, shade
import character

random.seed(7)
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'public', 'assets')

# ---------------------------------------------------------------- palette
C = {k: hexc(v) for k, v in {
    'ink': '#3a2832',
    'wood_d': '#7a4b35', 'wood': '#a8693f', 'wood_l': '#c98d58', 'wood_h': '#e2b07a',
    'plank_a': '#c99467', 'plank_b': '#bb855a', 'plank_c': '#d4a273', 'seam': '#9a6646',
    'wall': '#f4d9cf', 'wall_s': '#ecc8bf', 'wall_stripe': '#f0cfc4', 'wains': '#d9a07a', 'wains_d': '#bf865f',
    'cap': '#fbe9df', 'beam': '#8a5a40',
    'grass': '#8ccf7e', 'grass_d': '#6db466', 'grass_l': '#a9e08f',
    'dirt': '#b77d57', 'dirt_d': '#8f5b3f', 'dirt_dd': '#6b4230', 'stone': '#a49a9c',
    'bloom': '#ffc9d8', 'bloom_d': '#f4a2bc', 'bloom_dd': '#e083a2', 'bloom_l': '#ffe4ec', 'trunk': '#6e4532',
    'leaf': '#6fae62', 'leaf_d': '#4f8a4d', 'leaf_l': '#93cc78', 'pot': '#c9714d', 'pot_d': '#a85a3c',
    'sofa': '#97bfa8', 'sofa_d': '#7ba58f', 'sofa_l': '#b5d6c2', 'pillow': '#f6d58e', 'pillow2': '#f2a7a0',
    'rug': '#f3e1c9', 'rug_d': '#e8c9ae', 'rug_p': '#e6a9a1', 'rug_g': '#a8cdb5',
    'metal': '#9aa1b5', 'metal_d': '#757b91', 'metal_l': '#c3c9d8', 'screen': '#2e3448', 'screen_l': '#3f4862',
    'glow': '#ffe7a3', 'lamp': '#f7c873', 'lamp_d': '#d9a24f',
    'cork': '#d6a46c', 'cork_d': '#c08f59', 'paper': '#fff8ea', 'note_y': '#ffe88a', 'note_p': '#ffc2cf', 'note_b': '#bfe2f2',
    'glass': '#d8f1f6', 'white': '#ffffff', 'cream': '#fff3df',
    'led_g': '#7be38a', 'led_r': '#ff6b6b', 'led_a': '#ffc864', 'led_off': '#5b6175', 'code1': '#9fe0d8', 'code2': '#f4b9c8', 'code3': '#ffe38a',
}.items()}

BOOK_COLS = [hexc(h) for h in ('#d06a5f', '#5f8fc9', '#e3b85c', '#7fb07a', '#a77cc2', '#e98aa8', '#6b9fa0', '#c98d58')]

N = 28          # room floor size (world units)
F = 3           # floor slab thickness: furniture stands on z = F
WALL_H = 30     # eave height above z=0
GABLE = 26      # extra height of the gable peak (iso squashes it, so it must be tall)
SW, SH = 240, 210
iso = Iso(120, 96)
P = iso.p


def new():
    return Spr(SW, SH)


def plane_left(px, py):
    """screen pixel -> (y, z) on the x=0 wall plane"""
    y = (iso.ox - (px + 0.5)) / 2
    return y, iso.oy + y - (py + 0.5)


def plane_right(px, py):
    """screen pixel -> (x, z) on the y=0 wall plane"""
    x = ((px + 0.5) - iso.ox) / 2
    return x, iso.oy + x - (py + 0.5)


def plane_y(px, py, y):
    """screen pixel -> (x, z) on a y=const plane"""
    x = ((px + 0.5) - iso.ox) / 2 + y
    return x, iso.oy + x + y - (py + 0.5)


def plane_x(px, py, x):
    """screen pixel -> (y, z) on an x=const plane"""
    y = x - ((px + 0.5) - iso.ox) / 2
    return y, iso.oy + x + y - (py + 0.5)


def floor_xy(px, py, z):
    a = ((px + 0.5) - iso.ox) / 2          # x - y
    b = (py + 0.5) - iso.oy + z            # x + y
    return (a + b) / 2, (b - a) / 2


def gable_top(x):
    return WALL_H + GABLE * max(0.0, 1 - abs(x - N / 2) / (N / 2))


# ---------------------------------------------------------------- walls
def wall_band(u, z, ztop):
    """shared wall finish: skirting, wainscot with panel grooves, rail, plaster"""
    if z < F + 1:
        return C['wood_d']
    if z < F + 8:
        if abs((u % 4) - 2) < 0.5:
            return C['wains_d']
        return C['wains']
    if z < F + 9:
        return C['wood_h']
    if z > ztop - 1.5:
        return C['wall_s']                                   # shadow under the eave
    return C['wall']


def wall_left_tex(px, py):
    y, z = plane_left(px, py)
    # window (two panes, mullion, sill) above the armchair
    wy0, wy1, wz0, wz1 = 13, 22, F + 12, F + 23
    if wy0 <= y <= wy1 and wz0 <= z <= wz1:
        frame = y < wy0 + 1 or y > wy1 - 1 or z < wz0 + 1 or z > wz1 - 1
        mull = abs(y - (wy0 + wy1) / 2) < 0.5 or abs(z - (wz0 + 6)) < 0.5
        if frame or mull:
            return C['cream']
        return (0, 0, 0, 0)                                  # glass: sky shows through
    if wz0 - 1.5 <= z < wz0 and wy0 - 1 <= y <= wy1 + 1:
        return C['wood_l']                                   # sill
    # little framed picture by the bookshelf
    if 5 <= y <= 9 and F + 24 <= z <= F + 28:
        if y < 5.5 or y > 8.5 or z < F + 24.5 or z > F + 27.5:
            return C['wood']
        return C['note_b'] if z > F + 26 else C['leaf_l']
    return wall_band(y, z, WALL_H)


def wall_right_tex(px, py):
    x, z = plane_right(px, py)
    # cork board (planning board)
    if 3 <= x <= 11 and F + 13 <= z <= F + 22:
        if x < 3.5 or x > 10.5 or z < F + 13.5 or z > F + 21.5:
            return C['wood']
        for (a, b, c0, c1, k) in ((4.5, 6.5, F + 17, F + 20.5, 'note_y'), (7, 9.5, F + 18, F + 21, 'note_p'),
                                  (4.5, 7, F + 14, F + 16.5, 'paper'), (7.5, 10, F + 14.5, F + 17, 'note_b')):
            if a <= x <= b and c0 <= z <= c1:
                return C[k]
        return C['cork']
    # round clock in the gable
    cx, cz = N / 2, WALL_H + 9
    d = (x - cx) ** 2 + ((z - cz) * 0.5) ** 2
    if d <= 2.6 ** 2:
        if d > 1.8 ** 2:
            return C['wood']
        if (abs(x - cx) < 0.3 and cz <= z <= cz + 2.6) or (abs(z - cz) < 0.6 and cx <= x <= cx + 1.4):
            return C['ink']
        return C['cream']
    return wall_band(x, z, gable_top(x))


def plank(px, py):
    x, y = floor_xy(px, py, F)
    if (x % 4) < 0.5:
        return C['seam']                                     # boards run along y
    row = int(x // 4)
    if ((y + row * 7) % 14) < 0.5:
        return C['seam']
    return (C['plank_a'], C['plank_c'], C['plank_b'])[row % 3]


def draw_tree(s, cx, cy, r, seed):
    """cherry blossom tree: short trunk, canopy of shaded puffs lit from the top-left (no noise)"""
    rnd = random.Random(seed)
    t = Spr(s.w, s.h)
    for i in range(int(r * 1.3)):
        for dx in range(3):
            t.put(cx - 1 + dx, cy + i, shade(C['trunk'], 1.2) if dx == 0 else C['trunk'] if dx == 1 else shade(C['trunk'], 0.8))
    puffs = [(cx, cy - r * 0.3, r * 0.5)]
    for ring, (rr, n, ps) in enumerate(((0.75, 9, 0.33), (0.4, 6, 0.36))):
        for i in range(n):
            a = 2 * math.pi * i / n + ring * 0.4 + rnd.uniform(-0.15, 0.15)
            puffs.append((cx + math.cos(a) * r * rr * 1.2, cy - r * 0.15 + math.sin(a) * r * rr * 0.8, r * ps * rnd.uniform(0.9, 1.1)))
    puffs.sort(key=lambda p: p[1])
    for (px0, py0, pr) in puffs:
        for y in range(int(py0 - pr) - 1, int(py0 + pr) + 2):
            for x in range(int(px0 - pr * 1.2) - 1, int(px0 + pr * 1.2) + 2):
                dx, dy = (x + 0.5 - px0) / 1.15, (y + 0.5 - py0)
                d = math.hypot(dx, dy)
                if d > pr:
                    continue
                l = (-dx * 0.55 - dy * 0.85) / pr
                if d > pr - 1.1 and l < 0:
                    col = C['bloom_dd']                       # rim on the shadow side
                elif l > 0.4:
                    col = C['bloom_l']
                elif l > -0.15:
                    col = C['bloom']
                else:
                    col = C['bloom_d']
                t.put(x, y, col)
    t.outline(color=shade(C['bloom_dd'], 0.62))
    s.paste(t, 0, 0)


def draw_room_base(s):
    # cherry trees peeking from behind the cabin
    tl = P(-2, 12, WALL_H + 2)
    draw_tree(s, tl[0] - 12, tl[1] - 2, 15, 1)
    tr = P(20, -2, WALL_H + 4)
    draw_tree(s, tr[0] + 14, tr[1] - 4, 17, 2)
    # floor slab: planks on top, dark beam edges
    iso.box(s, 0, 0, 0, N, N, F, plank,
            lambda px, py: C['beam'] if plane_y(px, py, N)[1] > 0.9 else shade(C['beam'], 0.8),
            lambda px, py: shade(C['beam'], 0.85) if plane_x(px, py, N)[1] > 0.9 else shade(C['beam'], 0.68))
    # ambient occlusion: one darker plank row along both walls
    s.poly([P(0, 0, F), P(N, 0, F), P(N, 1, F), P(1, 1, F), P(1, N, F), P(0, N, F)], lambda px, py: shade(plank(px, py), 0.86))
    # walls (1 unit thick); right wall is a gable
    iso.box(s, -1, -1, 0, 1, N + 1, WALL_H, C['cap'], C['wood'], wall_left_tex, rim=False)
    gab = [P(N, 0, WALL_H), P(N / 2, 0, WALL_H + GABLE), P(0, 0, WALL_H), P(0, 0, 0), P(N, 0, 0)]
    s.poly(gab, wall_right_tex)
    s.poly([P(N, -1, 0), P(N, 0, 0), P(N, 0, WALL_H), P(N, -1, WALL_H - 0.5)], C['wood_d'])
    # roof: dark eave beam along the left wall top and a thick trim along the gable
    iso.box(s, -2, -2, WALL_H, 3, N + 3, 2, C['beam'], shade(C['beam'], 0.85), shade(C['beam'], 0.7), rim=False)
    for side in (-1, 1):
        x0, x1 = N / 2, (N + 3) if side > 0 else -3
        z0, z1 = WALL_H + GABLE, WALL_H - 3 * GABLE / (N / 2)
        top = [P(x0, 0, z0 + 3.5), P(x1, 0, z1 + 3.5)]
        bot = [P(x1, 0, z1 - 0.3), P(x0, 0, z0 - 0.3)]
        s.poly(top + bot, C['beam'])
        s.poly([P(x0, 0, z0 + 3.5), P(x1, 0, z1 + 3.5), P(x1, 0, z1 + 2.6), P(x0, 0, z0 + 2.6)], shade(C['beam'], 1.3))
    # string lights under the trim
    for i in range(3, N - 2, 3):
        p = P(i, 0, gable_top(i) - 2)
        col = [C['led_a'], C['note_p'], C['note_b']][(i // 3) % 3]
        s.put(p[0], p[1], col)
        s.put(p[0], p[1] + 1, shade(col, 0.8))
    # rug
    rx0, ry0, rx1, ry1 = 7, 11, 19, 24

    def rug(px, py):
        x, y = floor_xy(px, py, F)
        if x < rx0 + 0.8 or x > rx1 - 0.8 or y < ry0 + 0.8 or y > ry1 - 0.8:
            return C['rug_p']
        if x < rx0 + 1.6 or x > rx1 - 1.6 or y < ry0 + 1.6 or y > ry1 - 1.6:
            return C['rug']
        return C['rug_d']
    s.poly([P(rx0, ry0, F), P(rx1, ry0, F), P(rx1, ry1, F), P(rx0, ry1, F)], rug)
    # window light patch on the floor (one flat lighter tone)
    s.poly([P(1, 14, F), P(5, 17, F), P(5, 25, F), P(1, 22, F)], lambda px, py: shade(rug(px, py) if floor_xy(px, py, F)[0] > rx0 else plank(px, py), 1.18))
    # wall shelf above the desk with books and a small pot
    iso.box(s, 15, 0, F + 19, 9, 2.5, 1, C['wood_h'], C['wood_l'], C['wood'])
    x = 15.5
    for i, (w, h) in enumerate(((1, 4), (1, 5), (1, 4), (1, 5))):
        iso.box(s, x, 0, F + 20, w, 2.5, h, shade(BOOK_COLS[i], 1.15), BOOK_COLS[i], shade(BOOK_COLS[i], 0.8))
        x += w
    iso.box(s, 21, 0.5, F + 20, 2, 2, 2, C['pot'], C['pot'], C['pot_d'])
    p = P(22, 1.5, F + 23)
    bush(s, p[0], p[1], 3, 2)


def bush(s, cx, cy, rx, ry):
    """leafy clump: clean ellipse, lit from top-left, darker at the bottom-right (no noise)"""
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            if dx * dx + dy * dy > 1:
                continue
            l = -dx * 0.6 - dy * 0.8
            s.put(x, y, C['leaf_l'] if l > 0.35 else C['leaf'] if l > -0.35 else C['leaf_d'])


def shadow(s, x0, y0, x1, y1):
    """contact shadow on the floor under a piece of furniture (flat darker floor tone)"""
    s.poly([P(x0, y0, F), P(x1, y0, F), P(x1, y1, F), P(x0, y1, F)],
           lambda px, py: (58, 40, 50, 70))


# ---------------------------------------------------------------- furniture (each its own sprite for depth sorting)
FURN = []   # (name, spr, box(x0,y0,x1,y1))


def furn(name, box):
    s = new()
    FURN.append((name, s, box))
    return s


def make_furniture():
    # plant in the back corner
    s = furn('plant', (0.5, 0.5, 4.5, 4.5))
    iso.box(s, 1, 1, F, 3, 3, 4, C['pot'], C['pot'], C['pot_d'])
    for (dz, dx, rx, ry) in ((F + 7, -2, 4, 3), (F + 8, 2, 4, 3), (F + 11, 0, 5, 4), (F + 14, 1, 4, 3)):
        p = P(2.5, 2.5, dz)
        bush(s, p[0] + dx, p[1], rx, ry)

    # bookshelf against the left wall
    s = furn('bookshelf', (0, 4.5, 4, 11))
    iso.box(s, 0, 4.5, F, 4, 6.5, 22, C['wood_l'], C['wood'], C['wood_d'])

    def shelf_front(px, py):
        y, z = plane_x(px, py, 4)
        z -= F
        if y < 5.2 or y > 10.3 or z < 1 or z > 21:
            return C['wood']
        if any(abs(z - b) < 0.6 for b in (7, 14)):
            return C['wood_l']
        row = 0 if z < 7 else 1 if z < 14 else 2
        base_z = (1, 7.6, 14.6)[row]
        bi = int((y - 5.2) / 1.0)
        hgt = 4 + (bi * 5 + row * 3) % 3
        if z - base_z > hgt:
            return shade(C['wood_d'], 0.85)
        col = BOOK_COLS[(bi * 3 + row * 5) % len(BOOK_COLS)]
        if abs(z - base_z - hgt + 0.7) < 0.5:
            return shade(col, 1.3)
        return col
    s.poly([P(4, 4.5, F + 22), P(4, 11, F + 22), P(4, 11, F), P(4, 4.5, F)], shelf_front)

    # desk against the right wall
    s = furn('desk', (13, 0, 24, 6))
    shadow(s, 13, 0, 24, 6.5)
    for (lx, ly) in ((13, 4.5), (23, 4.5)):
        iso.box(s, lx, ly, F, 1, 1, 12, C['wood'], C['wood'], C['wood_d'])
    iso.box(s, 19, 0.5, F + 4, 4.5, 5, 8, C['wood_l'], C['wood'], C['wood_d'])           # drawers
    for dz in (6, 10):
        p = P(21, 5.5, F + dz)
        s.put(p[0], p[1], C['wood_h']); s.put(p[0] + 1, p[1] + 1, C['wood_h'])
    iso.box(s, 13, 0, F + 12, 11, 6, 1.5, C['wood_h'], C['wood_l'], C['wood'])           # top
    iso.box(s, 17.5, 3.5, F + 13.5, 5, 2, 0.6, C['cream'], shade(C['cream'], 0.85), shade(C['cream'], 0.75))  # keyboard
    iso.box(s, 22.3, 3.5, F + 13.5, 1.2, 1.2, 1.6, C['white'], C['note_p'], shade(C['note_p'], 0.85))  # mug
    iso.box(s, 13.5, 1, F + 13.5, 2, 2, 0.6, C['lamp_d'], C['lamp_d'], shade(C['lamp_d'], 0.8))   # desk lamp
    for i in range(5):
        p = P(14.5, 2, F + 14 + i)
        s.put(p[0], p[1], C['lamp_d'])
    iso.box(s, 13.8, 1.3, F + 19, 2.5, 2, 1.5, C['lamp'], C['lamp_d'], shade(C['lamp_d'], 0.85))

    # monitor
    s = furn('monitor', (17, 1, 23, 3))
    iso.box(s, 19.5, 1.5, F + 13.5, 1, 1, 1.5, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 18.5, 1, F + 13.5, 3, 2, 0.5, C['metal_l'], C['metal'], C['metal_d'])
    iso.box(s, 17, 2, F + 15, 6, 1, 8, C['metal_l'], C['metal'], C['metal_d'])

    # chair: seat, then the backrest as its own sprite so the sitter is drawn in between
    s = furn('chair', (17, 8, 22, 12))
    shadow(s, 17, 8, 22, 12.5)
    for (bx, by) in ((17.5, 8.5), (20.5, 8.5), (17.5, 11), (20.5, 11)):
        iso.box(s, bx, by, F, 1, 1, 0.8, C['ink'], C['ink'], C['ink'])
    iso.box(s, 19, 9.8, F + 0.8, 1, 1, 4.5, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 17, 8, F + 5, 5, 4, 1.5, C['pillow2'], shade(C['pillow2'], 0.85), shade(C['pillow2'], 0.72))
    s = furn('chair_back', (17, 12, 22, 13.5))
    iso.box(s, 19, 12, F + 6.5, 1, 1, 2, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 17, 12, F + 8.5, 5, 1.2, 6, C['pillow2'], shade(C['pillow2'], 0.85), shade(C['pillow2'], 0.72))

    # armchair under the window (rest spot); front arm separately
    s = furn('sofa', (0, 15, 6, 19.5))
    shadow(s, 0, 15, 6.5, 21.5)
    iso.box(s, 0, 15, F, 6, 6, 1, C['wood_d'], C['wood_d'], shade(C['wood_d'], 0.8))
    iso.box(s, 0, 15, F + 1, 6, 6, 4, C['sofa'], C['sofa_d'], shade(C['sofa_d'], 0.85))
    iso.box(s, 0, 15, F + 5, 2, 6, 7, C['sofa_l'], C['sofa_d'], C['sofa'])                # back
    iso.box(s, 2, 15, F + 5, 4, 1.5, 3, C['sofa_l'], C['sofa_d'], C['sofa'])              # rear arm
    iso.box(s, 2, 16.5, F + 5, 1.6, 3, 3, C['pillow'], shade(C['pillow'], 0.88), shade(C['pillow'], 0.78))
    s = furn('sofa_arm', (0, 19.5, 6, 21))
    iso.box(s, 0, 19.5, F + 5, 6, 1.5, 3, C['sofa_l'], C['sofa_d'], C['sofa'])

    # tea table with a mug and a book
    s = furn('table', (8, 17, 11, 20))
    shadow(s, 8, 17, 11.5, 20.5)
    iso.box(s, 9, 18, F, 1, 1, 5, C['wood'], C['wood'], C['wood_d'])
    iso.box(s, 8.5, 17.5, F, 2, 2, 0.6, C['wood_d'], C['wood_d'], C['wood_d'])
    iso.box(s, 8, 17, F + 5, 3, 3, 1, C['wood_h'], C['wood_l'], C['wood'])
    iso.box(s, 8.3, 18.3, F + 6, 1.6, 1.4, 0.5, BOOK_COLS[1], BOOK_COLS[1], shade(BOOK_COLS[1], 0.8))
    iso.box(s, 9.8, 17.4, F + 6, 1, 1, 1.4, C['white'], C['cream'], shade(C['cream'], 0.85))

    # test rig on a metal stand in the back-right corner, next to the desk
    s = furn('bench', (24.5, 0, 28, 4.5))
    shadow(s, 24.5, 0, 28.5, 5)
    for (lx, ly) in ((24.8, 3.2), (27, 3.2)):
        iso.box(s, lx, ly, F, 0.8, 0.8, 9, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 24.8, 0.5, F + 3, 3, 3, 0.6, C['metal_d'], C['metal_d'], C['metal_d'])      # lower shelf
    iso.box(s, 25.3, 1, F + 3.6, 2, 2, 2, C['note_b'], shade(C['note_b'], 0.85), shade(C['note_b'], 0.7))
    iso.box(s, 24.5, 0, F + 9, 3.5, 4.5, 1, C['wood_h'], C['wood_l'], C['wood'])
    iso.box(s, 24.8, 0.3, F + 10, 3, 3.2, 5, C['metal_l'], C['metal'], C['metal_d'])    # rig box
    iso.box(s, 26.5, 1, F + 15, 0.6, 0.6, 2.5, C['metal_d'], C['metal_d'], C['metal_d'])  # antenna
    p = P(26.8, 1.3, F + 17.8); s.put(p[0], p[1], C['led_r'])
    for i, col in enumerate((C['led_g'], C['note_b'], C['note_p'])):           # test tubes
        p = P(25 + i * 0.9, 4, F + 10)
        s.rect(p[0], p[1] - 3, 1, 3, col); s.put(p[0], p[1] - 4, C['glass'])

    # floor cushion and a potted plant to fill the open front of the room
    s = furn('pouf', (11, 23, 14.5, 26.5))
    shadow(s, 11, 23, 15, 27)
    iso.box(s, 11, 23, F, 3.5, 3.5, 2.5, C['note_y'], shade(C['note_y'], 0.85), shade(C['note_y'], 0.72))
    iso.box(s, 12.2, 24.2, F + 2.5, 1.1, 1.1, 0.3, shade(C['note_y'], 0.8), shade(C['note_y'], 0.8), shade(C['note_y'], 0.8), rim=False)
    s = furn('pot2', (25, 16, 27.5, 18.5))
    shadow(s, 25, 16, 28, 19)
    iso.box(s, 25, 16, F, 2.5, 2.5, 3, C['pot'], C['pot'], C['pot_d'])
    p = P(26.25, 17.25, F + 6)
    bush(s, p[0] - 1, p[1], 3, 3)
    bush(s, p[0] + 2, p[1] - 2, 3, 2)

    # floor lamp near the armchair
    s = furn('floor_lamp', (1, 23, 3, 25))
    iso.box(s, 1, 23, F, 2, 2, 0.6, C['wood_d'], C['wood_d'], C['wood_d'])
    for z in range(1, 17):
        p = P(2, 24, F + z)
        s.put(p[0], p[1], C['wood_d'])
    iso.box(s, 0.6, 22.6, F + 16, 2.8, 2.8, 4, C['cream'], C['glow'], shade(C['glow'], 0.9))


SCREEN_FACE = (17, 3, F + 15.5, 23, F + 22.5)   # x0, y(plane), z0, x1, z1 of the monitor's viewer-facing face


def screen_frames():
    """Monitor screen overlays drawn over the monitor's y-plane face; u = x units (0..6), v = z px (0..7)."""
    x0, yp, z0, x1, z1 = SCREEN_FACE
    pts = [P(x0 + 0.5, yp, z1), P(x1 - 0.5, yp, z1), P(x1 - 0.5, yp, z0), P(x0 + 0.5, yp, z0)]

    def mk(fn):
        s = new()
        s.poly(pts, lambda px, py: fn(*uv(px, py)))
        return s

    def uv(px, py):
        x, z = plane_y(px, py, yp)
        return x - x0, int(z - z0)

    def glyph(u, v, rows, col, bg):
        # rows: list of strings, centred; u in 0.5-unit columns (=1px), v in px rows (top=row 0)
        h, w = len(rows), len(rows[0])
        cu, cv = int((u - 0.5) * 2) - (10 - w) // 2, (6 - v) - (7 - h) // 2
        if 0 <= cv < h and 0 <= cu < w and rows[cv][cu] == 'x':
            return col
        return bg
    frames = {}
    frames['scr_off'] = mk(lambda u, v: C['screen_l'] if v >= 6 else C['screen'])
    frames['scr_idle'] = mk(lambda u, v: glyph(u, v, ['xx', 'xx'], C['code1'], C['screen_l']))
    for f in range(4):
        def code(u, v, f=f):
            line = (v + f) // 2
            if (v + f) % 2 == 0:
                ind = (line * 7) % 3 * 0.5
                ln = 1.5 + (line * 5) % 4
                if 0.5 + ind < u < 0.5 + ind + ln:
                    return (C['code1'], C['code2'], C['code3'])[line % 3]
            return C['screen']
        frames[f'scr_code{f}'] = mk(code)
    for f in range(2):
        frames[f'scr_read{f}'] = mk(lambda u, v, f=f: C['seam'] if 1 < u < 5 and (v + f) % 2 == 0 and 1 <= v <= 5 else C['paper'] if 0.5 < u < 5.5 else C['screen_l'])
    frames['scr_err'] = mk(lambda u, v: glyph(u, v, ['x...x', '.x.x.', '..x..', '.x.x.', 'x...x'], C['led_r'], shade(C['led_r'], 0.4)))
    frames['scr_ok'] = mk(lambda u, v: glyph(u, v, ['....x', '...x.', 'x.x..', '.x...'], C['led_g'], shade(C['led_g'], 0.35)))
    frames['scr_wait'] = mk(lambda u, v: glyph(u, v, ['x', 'x', 'x', '.', 'x'], C['led_a'], shade(C['led_a'], 0.4)))
    return frames


def rig_frames():
    """Status LEDs + gauge on the rig box's viewer-facing (y = 21) face."""
    out = {}
    yp = 3.5
    states = {
        'rig_idle': [C['led_a'], C['led_off'], C['led_off']],
        'rig_run0': [C['led_a'], C['led_off'], C['led_off']],
        'rig_run1': [C['led_off'], C['led_a'], C['led_off']],
        'rig_run2': [C['led_off'], C['led_off'], C['led_a']],
        'rig_pass': [C['led_g'], C['led_g'], C['led_g']],
        'rig_fail': [C['led_r'], C['led_r'], C['led_r']],
    }
    for name, cols in states.items():
        s = new()
        s.poly([P(25.2, yp, F + 14.5), P(27.5, yp, F + 14.5), P(27.5, yp, F + 11.5), P(25.2, yp, F + 11.5)], C['screen'])
        for i, col in enumerate(cols):
            p = P(25.5 + i * 0.7, yp, F + 13.8)
            s.rect(p[0], p[1], 1, 1, col)
        fill = {'rig_idle': 0, 'rig_run0': 1, 'rig_run1': 2, 'rig_run2': 3, 'rig_pass': 3, 'rig_fail': 3}[name]
        bar = C['led_r'] if name == 'rig_fail' else C['led_g']
        for i in range(3):
            p = P(25.5 + i * 0.7, yp, F + 12.3)
            s.rect(p[0], p[1], 1, 1, bar if i < fill else C['led_off'])
        out[name] = s
    return out


def cloud(w, h, seed):
    rnd = random.Random(seed)
    s = Spr(w, h)
    blobs = []
    for i in range(7):
        bx = rnd.uniform(w * 0.2, w * 0.8)
        br = rnd.uniform(h * 0.25, h * 0.45)
        blobs.append((bx, h - br - 1, br))
    blobs.append((w * 0.15, h - h * 0.22 - 1, h * 0.22))
    blobs.append((w * 0.85, h - h * 0.2 - 1, h * 0.2))
    for y in range(h):
        for x in range(w):
            best = None
            for (bx, by, br) in blobs:
                d = math.hypot(x - bx, (y - by) * 1.2)
                if d <= br:
                    l = (y - (by - br)) / (2 * br)
                    best = l if best is None else min(best, l)
            if best is not None:
                if y > h - 3:
                    col = hexc('#f5d6e4')
                elif best > 0.62:
                    col = hexc('#f9e3ee')
                elif best > 0.42:
                    col = hexc('#fdf3f8')
                else:
                    col = hexc('#ffffff')
                s.put(x, y, col)
    return s


def bubble(icon):
    """11x12 speech bubble with an icon"""
    s = Spr(13, 13)
    body = [
        ".ooooooooooo.",
        "owwwwwwwwwwwo",
        "owwwwwwwwwwwo",
        "owwwwwwwwwwwo",
        "owwwwwwwwwwwo",
        "owwwwwwwwwwwo",
        "owwwwwwwwwwwo",
        "owwwwwwwwwwwo",
        "owwwwwwwwwwwo",
        ".oooowwoooooo",
        "....owo......",
        ".....o.......",
    ]
    pal = {'o': C['ink'], 'w': C['white']}
    for y, r in enumerate(body):
        for x, ch in enumerate(r):
            if ch in pal:
                s.put(x, y, pal[ch])
    icons = {
        'bang': (["..x..", "..x..", "..x..", ".....", "..x.."], C['led_r']),
        'ask': ([".xxx.", "x...x", "...x.", ".....", "..x.."], hexc('#5f8fc9')),
        'check': (["....x", "...x.", "x.x..", ".x...", "....."], hexc('#4fae62')),
        'cross': (["x...x", ".x.x.", "..x..", ".x.x.", "x...x"], C['led_r']),
        'dots': ([".....", ".....", "x.x.x", ".....", "....."], C['ink']),
        'note': (["..xx.", "..x.x", "..x..", "xxx..", "xx..."], hexc('#e083a2')),
        'heart': ([".x.x.", "xxxxx", "xxxxx", ".xxx.", "..x.."], hexc('#e66b86')),
        'gear': (["x.x.x", ".xxx.", "xx.xx", ".xxx.", "x.x.x"], C['metal_d']),
        'book': (["xx.xx", "xx.xx", "xx.xx", "xx.xx", "....."], hexc('#c65a5a')),
        'zzz': (["xxxx.", "..x..", ".x...", "xxxx.", "....."], hexc('#7d86b3')),
    }
    rows, col = icons[icon]
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == 'x':
                s.put(4 + x, 2 + y, col)
    return s


def small_fx():
    out = {}
    out['sparkle0'] = from_rows(["..x..", ".xyx.", "xyyyx", ".xyx.", "..x.."], {'x': hexc('#fff6b0'), 'y': C['white']})
    out['sparkle1'] = from_rows(["x...x", ".x.x.", "..y..", ".x.x.", "x...x"], {'x': hexc('#fff6b0'), 'y': C['white']})
    out['sweat'] = from_rows([".x.", "xyx", "xyx", ".x."], {'x': hexc('#7cc4e8'), 'y': hexc('#d9f2ff')})
    out['steam0'] = from_rows([".x.", "x..", ".x.", "..x"], {'x': C['white']})
    out['steam1'] = from_rows(["x..", ".x.", "..x", ".x."], {'x': C['white']})
    out['petal'] = from_rows(["xy", "y."], {'x': C['bloom_l'], 'y': C['bloom_d']})
    out['petal2'] = from_rows([".x", "xy"], {'x': C['bloom'], 'y': C['bloom_dd']})
    out['shadow'] = from_rows([".xxxxxx.", "xxxxxxxx", ".xxxxxx."], {'x': (58, 40, 50, 60)})
    return out


def from_rows(rows, pal):
    s = Spr(max(len(r) for r in rows), len(rows))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in pal:
                s.put(x, y, pal[ch])
    return s


# ---------------------------------------------------------------- build
def main():
    os.makedirs(OUT, exist_ok=True)
    sprites = {}   # name -> (Spr, dx, dy)   dx,dy = placement in scene coordinates (or 0,0)

    base = new()
    draw_room_base(base)
    b, bx, by = base.crop()
    sprites['room'] = (b, bx, by)

    make_furniture()
    furniture = []
    for (name, s, box) in FURN:
        s.outline(factor=0.55)
        c, x, y = s.crop()
        sprites[name] = (c, x, y)
        furniture.append({'name': name, 'box': box})
    for name, s in {**screen_frames(), **rig_frames()}.items():
        c, x, y = s.crop()
        sprites[name] = (c, x, y)

    for name, s in small_fx().items():
        sprites[name] = (s, 0, 0)
    for icon in ('bang', 'ask', 'check', 'cross', 'dots', 'note', 'heart', 'gear', 'book', 'zzz'):
        sprites['bubble_' + icon] = (bubble(icon), 0, 0)
    for i, (w, h) in enumerate(((72, 26), (54, 20), (38, 14), (96, 30))):
        sprites[f'cloud{i}'] = (cloud(w, h, 20 + i), 0, 0)
    for agent in character.AGENT_LOOKS:
        for fname in character.FRAMES:
            sprites[f'ch_{agent}_{fname}'] = (character.render_frame(fname, agent), 0, 0)

    # pack (simple shelf packer)
    items = sorted(sprites.items(), key=lambda kv: -kv[1][0].h)
    AW = 1024
    x = y = rowh = 0
    pos = {}
    for name, (s, dx, dy) in items:
        if x + s.w + 1 > AW:
            x = 0
            y += rowh + 1
            rowh = 0
        pos[name] = (x, y)
        x += s.w + 1
        rowh = max(rowh, s.h)
    AH = y + rowh + 1
    atlas = Image.new('RGBA', (AW, AH), (0, 0, 0, 0))
    frames = {}
    for name, (s, dx, dy) in sprites.items():
        ax, ay = pos[name]
        atlas.alpha_composite(s.im, (ax, ay))
        frames[name] = {'x': ax, 'y': ay, 'w': s.w, 'h': s.h, 'dx': dx, 'dy': dy}
    atlas.save(os.path.join(OUT, 'atlas.png'))

    layout = {
        'scene': {'w': SW, 'h': SH, 'ox': iso.ox, 'oy': iso.oy, 'room': N, 'floorZ': F},
        'furniture': furniture,
        'screen': SCREEN_FACE,
        'char': {'w': character.W, 'h': character.H, 'ax': character.W // 2, 'ay': character.H - 1,
                 'agents': list(character.AGENT_LOOKS), 'frames': list(character.FRAMES)},
        'spots': {
            'desk': {'x': 19.5, 'y': 10, 'face': 'ur', 'z': 6, 'sit': True},
            'shelf': {'x': 6.5, 'y': 7.5, 'face': 'ul'},
            'board': {'x': 7.5, 'y': 3.5, 'face': 'ur'},
            'bench': {'x': 26.2, 'y': 7, 'face': 'ur'},
            'sofa': {'x': 3.8, 'y': 17.8, 'face': 'dr', 'z': 5, 'sit': True},
            'center': {'x': 14, 'y': 15, 'face': 'dr'},
            'front': {'x': 17.5, 'y': 22, 'face': 'dr'},
            'window': {'x': 8, 'y': 13, 'face': 'ul'},
            'plantcorner': {'x': 6, 'y': 2.5, 'face': 'ul'},
        },
        'nodes': {
            'center': [14, 15], 'deskA': [19.5, 14], 'desk': [19.5, 10], 'shelfA': [8, 9], 'shelf': [6.5, 7.5],
            'board': [7.5, 3.5], 'bench': [26.2, 7], 'benchA': [24, 14], 'sofaA': [9, 14], 'sofaB': [7, 18], 'sofa': [3.8, 17.8],
            'front': [17.5, 22], 'window': [8, 13], 'plantcorner': [6, 2.5],
        },
        'edges': [['center', 'deskA'], ['deskA', 'desk'], ['center', 'shelfA'], ['shelfA', 'shelf'], ['shelf', 'board'],
                  ['board', 'plantcorner'], ['center', 'sofaA'], ['sofaA', 'sofaB'], ['sofaB', 'sofa'], ['sofaA', 'window'],
                  ['window', 'shelfA'], ['center', 'benchA'], ['deskA', 'benchA'], ['benchA', 'bench'], ['center', 'front'], ['front', 'benchA']],
        'steam': list(P(10.3, 17.9, F + 8)),
    }
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump({'frames': frames, 'layout': layout}, f, separators=(',', ':'))
    print('atlas', AW, AH, len(frames), 'sprites')


if __name__ == '__main__':
    main()
