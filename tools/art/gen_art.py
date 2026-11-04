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

N = 48          # room size (world units)
WALL_H = 50
SW, SH = 360, 250
iso = Iso(180, 70)
P = iso.p


def new():
    return Spr(SW, SH)


def plane_left(px, py, ox=iso.ox, oy=iso.oy):
    """screen pixel -> (y, z) on the x=0 wall plane"""
    y = (ox - (px + 0.5)) / 2
    z = oy + y - (py + 0.5)
    return y, z


def plane_right(px, py, ox=iso.ox, oy=iso.oy):
    """screen pixel -> (x, z) on the y=0 wall plane"""
    x = ((px + 0.5) - ox) / 2
    z = oy + x - (py + 0.5)
    return x, z


def floor_xy(px, py, z=0):
    a = ((px + 0.5) - iso.ox) / 2          # x - y
    b = (py + 0.5) - iso.oy + z            # x + y
    return (a + b) / 2, (b - a) / 2


def plane_y_z(px, py, y):
    """z of the y=const face at screen pixel"""
    x = ((px + 0.5) - iso.ox) / 2 + y
    return iso.oy + x + y - (py + 0.5)


def plane_x_z(px, py, x):
    """z of the x=const face at screen pixel"""
    y = x - ((px + 0.5) - iso.ox) / 2
    return iso.oy + x + y - (py + 0.5)


def noise(px, py, k=0):
    return (hash((px * 73856093) ^ (py * 19349663) ^ (k * 83492791)) % 1000) / 1000


# ---------------------------------------------------------------- scene pieces
def wall_left_tex(px, py):
    y, z = plane_left(px, py)
    # window (round-top) above the sofa
    wy0, wy1, wz0, wz1 = 26, 41, 21, 41
    cyw = (wy0 + wy1) / 2
    rw = (wy1 - wy0) / 2
    in_arch = (z <= wz1 - rw) or ((y - cyw) ** 2 + ((z - (wz1 - rw)) * 1.0) ** 2 <= rw * rw)
    if wy0 <= y <= wy1 and wz0 <= z <= wz1 and in_arch:
        inner = wy0 + 1.2 <= y <= wy1 - 1.2 and wz0 + 1.5 <= z and ((z <= wz1 - rw) or ((y - cyw) ** 2 + (z - (wz1 - rw)) ** 2 <= (rw - 1.3) ** 2))
        if not inner:
            return C['cream']
        if abs(y - cyw) < 0.5 or abs(z - (wz0 + 9)) < 0.6:
            return C['cream']
        return (0, 0, 0, 0)  # see-through glass (sky shows behind)
    if wz0 - 3 <= z < wz0 and wy0 - 1.5 <= y <= wy1 + 1.5:   # sill
        return C['wood_l'] if z > wz0 - 1.5 else C['wood']
    # little framed picture
    if 7 <= y <= 13 and 30 <= z <= 38 and False:
        return C['wood']
    return wall_common(y, z)


def wall_common(u, z):
    if z < 1.2:
        return C['wood_d']                                   # skirting
    if z < 14:
        if z > 12.8:
            return C['wood_h']
        if abs((u % 6) - 3) < 0.5:
            return C['wains_d']
        return C['wains']
    if z < 15.2:
        return C['wood']
    if WALL_H - 3 < z:
        return C['wall_s']
    return C['wall_stripe'] if int(u) % 4 == 0 else C['wall']


def wall_right_tex(px, py):
    x, z = plane_right(px, py)
    # cork board (planning board) on the right wall
    if 3 <= x <= 17 and 19 <= z <= 37:
        if x < 4 or x > 16 or z < 20 or z > 36:
            return C['wood']
        notes = [(5, 9, 30, 35, 'note_y'), (10, 15, 31, 35.5, 'note_p'), (5.5, 10, 22, 28, 'paper'), (11, 15.5, 22, 29, 'note_b')]
        for (a, b, c0, c1, k) in notes:
            if a <= x <= b and c0 <= z <= c1:
                if k == 'paper' and int(z) % 2 == 0 and a + 0.7 < x < b - 0.7:
                    return C['seam']
                return C[k]
        if abs(x - 8) < 0.5 and 27.5 < z < 29.5:
            return C['led_r']                                # pin
        return C['cork']
    # wall shelf above the desk
    if 22 <= x <= 41 and 38.5 <= z <= 40.5:
        return C['wood_l'] if z > 39.5 else C['wood']
    # clock
    cx, cz = 45, 33
    if (x - cx) ** 2 + ((z - cz) * 0.5) ** 2 <= 2.4 ** 2 * 1.0:
        d = (x - cx) ** 2 + ((z - cz) * 0.5) ** 2
        if d > 1.6 ** 2:
            return C['wood']
        if (abs(x - cx) < 0.3 and cz <= z <= cz + 2.5) or (abs(z - cz) < 0.6 and cx <= x <= cx + 1.2):
            return C['ink']
        return C['cream']
    return wall_common(x, z)


def draw_room_base(s):
    # plinth under the floor: flat cream block with one trim line (no ground, no texture noise)
    iso.box(s, -3, -3, -6, N + 3, N + 3, 6, C['cap'],
            lambda px, py: C['wains'] if plane_y_z(px, py, N) > -1.5 else C['cap'],
            lambda px, py: C['wains_d'] if plane_x_z(px, py, N) > -1.5 else C['wall_s'], rim=False)
    # floor slab (thick wooden beam edge)
    iso.box(s, 0, 0, 0, N, N, 3,
            lambda px, py: plank(px, py),
            lambda px, py: C['beam'] if (py % 4) else shade(C['beam'], 0.85),
            lambda px, py: shade(C['beam'], 0.85))
    # walls
    iso.box(s, -3, -3, 0, 3, N + 3, WALL_H + 3, C['cap'], C['wood'], wall_left_tex, rim=False)
    iso.box(s, -3, -3, 0, N + 3, 3, WALL_H + 3, C['cap'], wall_right_tex, C['wood_d'], rim=False)
    # re-draw left wall top cap so the corner joint is clean
    iso.box(s, -3, -3, WALL_H + 3, 3, N + 3, 0.01, C['cap'], C['cap'], C['cap'], faces=('top',), rim=False)
    # string lights along wall tops
    for i in range(2, N, 4):
        for (pt, k) in ((P(0, i, WALL_H - 1), i), (P(i, 0, WALL_H - 1), i + 1)):
            col = [C['led_a'], C['note_p'], C['note_b'], C['glow']][k % 4]
            s.put(pt[0], pt[1] + (k % 2), col)
            s.put(pt[0], pt[1] + 1 + (k % 2), shade(col, 0.85))
    # rug
    rx0, ry0, rx1, ry1 = 13, 21, 35, 45

    def rug(px, py):
        x, y = floor_xy(px, py, 3)
        if x < rx0 + 1 or x > rx1 - 1 or y < ry0 + 1 or y > ry1 - 1:
            return C['rug_d']
        if (x < rx0 + 2.5 or x > rx1 - 2.5 or y < ry0 + 2.5 or y > ry1 - 2.5):
            return C['rug_p']
        cx, cy = (rx0 + rx1) / 2, (ry0 + ry1) / 2
        if abs(x - cx) + abs(y - cy) < 4.5:
            return C['rug_g'] if abs(x - cx) + abs(y - cy) > 2.5 else C['rug_p']
        if int((x - rx0) / 3) % 2 == int((y - ry0) / 3) % 2 and 3 < x - rx0 < rx1 - rx0 - 3:
            return C['rug']
        return shade(C['rug'], 0.97)
    s.poly([P(rx0, ry0, 3), P(rx1, ry0, 3), P(rx1, ry1, 3), P(rx0, ry1, 3)], rug)
    # wall shelf props (above the desk)
    shelf_props(s)


def plank(px, py):
    x, y = floor_xy(px, py, 3)
    row = int(y // 5)
    off = (row * 13) % 17
    if (y % 5) < 0.55:
        return C['seam']
    if ((x + off) % 17) < 0.5:
        return C['seam']
    k = (row + int((x + off) // 17)) % 3
    base = (C['plank_a'], C['plank_b'], C['plank_c'])[k]
    return base


def shelf_props(s):
    # little books and a plant on the wall shelf (y=0..3, z=40.5)
    x = 23
    for i, h in enumerate((6, 7, 5, 6)):
        iso.box(s, x, 0, 40.5, 1.4, 3, h, shade(BOOK_COLS[i], 1.15), BOOK_COLS[i], shade(BOOK_COLS[i], 0.8))
        x += 1.6
    iso.box(s, 36, 0.5, 40.5, 3, 2.5, 3, C['pot'], C['pot'], C['pot_d'])
    for (dx, dz) in ((0, 4), (1, 5), (2, 4), (1, 6), (3, 5), (-0.5, 5)):
        p = P(36 + dx, 1.5, 40.5 + dz)
        s.put(p[0], p[1], C['leaf_l'] if dz > 5 else C['leaf'])
        s.put(p[0] + 1, p[1], C['leaf_d'])


# ---------------------------------------------------------------- furniture (each a separate sprite for depth sorting)
FURN = []   # (name, spr, box(x0,y0,x1,y1))


def furn(name, box):
    s = new()
    FURN.append((name, s, box))
    return s


def make_furniture():
    # bookshelf against left wall
    s = furn('bookshelf', (0, 6, 8, 21))
    iso.box(s, 0, 6, 0, 8, 15, 40, C['wood_l'], C['wood'], C['wood_d'])

    def shelf_front(px, py):
        # front face is x=8 plane: param (y, z)
        y = (iso.ox + 2 * 8 - (px + 0.5)) / 2
        z = iso.oy + 8 + y - (py + 0.5)
        if y < 7.2 or y > 19.8 or z < 1.5 or z > 38.5:
            return C['wood']
        if any(abs(z - b) < 0.9 for b in (11, 21, 30)):
            return C['wood_l']
        row = 0 if z < 11 else 1 if z < 21 else 2 if z < 30 else 3
        base_z = (1.5, 11.9, 21.9, 30.9)[row]
        bi = int((y - 7.2) / 1.6)
        hgt = 6 + (bi * 7 + row * 3) % 4
        if row == 3 and bi > 4:
            hgt = 3 if bi % 2 else 4                  # small boxes on the top shelf
        if z - base_z > hgt:
            return shade(C['wood_d'], 0.85)
        col = BOOK_COLS[(bi * 3 + row * 5) % len(BOOK_COLS)]
        if abs(z - base_z - hgt + 1.5) < 0.5:
            return shade(col, 1.3)
        return col if (y - 7.2) % 1.6 > 0.35 else shade(col, 0.7)
    s.poly([P(8, 6, 40), P(8, 21, 40), P(8, 21, 0), P(8, 6, 0)], shelf_front)

    # plant in the back corner
    s = furn('plant', (1, 0.5, 6, 5))
    iso.box(s, 1.5, 0.5, 0, 4.5, 4.5, 7, C['pot'], C['pot'], C['pot_d'])
    rnd = random.Random(3)
    for i in range(70):
        a = rnd.uniform(0, math.pi * 2)
        r = rnd.uniform(0, 7)
        h = rnd.uniform(8, 26)
        p = P(3.7 + math.cos(a) * r * 0.5, 2.7 + math.sin(a) * r * 0.5, h)
        col = C['leaf_l'] if h > 20 else C['leaf'] if h > 13 else C['leaf_d']
        s.rect(p[0] - 1, p[1], 3, 2, col)
    for i in range(6):
        p = P(3.7, 2.7, 7 + i * 2)
        s.put(p[0], p[1], C['leaf_d'])

    # desk
    s = furn('desk', (21, 0, 41, 10))
    for (lx, ly) in ((21, 8), (39, 8)):
        iso.box(s, lx, ly, 0, 2, 2, 15, C['wood'], C['wood'], C['wood_d'])
    iso.box(s, 33, 0.5, 2, 7.5, 9, 13, C['wood_l'], C['wood'], C['wood_d'])           # drawers
    for dz in (5, 10):
        p = P(36.5, 9.5, dz)
        s.put(p[0], p[1], C['wood_h']); s.put(p[0] + 1, p[1] + 1, C['wood_h'])
    iso.box(s, 21, 0, 15, 20, 10, 2, C['wood_h'], C['wood_l'], C['wood'])               # top
    iso.box(s, 26.5, 5.5, 17, 8, 3, 0.8, C['cream'], shade(C['cream'], 0.85), shade(C['cream'], 0.75))  # keyboard
    for kx in range(27, 34, 1):
        p = P(kx + 0.5, 6.5, 17.8)
        s.put(p[0], p[1], shade(C['cream'], 0.8))
    iso.box(s, 36, 6, 17, 2, 2, 2.5, C['white'], C['note_p'], shade(C['note_p'], 0.85))     # mug on desk
    # desk lamp
    iso.box(s, 22.5, 2, 17, 3, 3, 0.8, C['lamp_d'], C['lamp_d'], shade(C['lamp_d'], 0.8))
    for i in range(9):
        p = P(23.8 + i * 0.15, 3.4, 18 + i)
        s.put(p[0], p[1], C['lamp_d'])
    iso.box(s, 23, 2.5, 26, 4, 3, 2.5, C['lamp'], C['lamp_d'], shade(C['lamp_d'], 0.85))

    # monitor
    s = furn('monitor', (27, 2, 35, 4))
    iso.box(s, 30, 2.5, 17, 2, 1.5, 3, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 28.5, 1.5, 17, 5, 3.5, 0.8, C['metal_l'], C['metal'], C['metal_d'])
    iso.box(s, 26.5, 2, 20, 9, 1.5, 12, C['metal_l'], C['metal'], C['metal_d'])

    # chair (seat part, then the backrest as its own sprite so the sitter can be drawn in between)
    s = furn('chair', (28, 13, 35, 19))
    for (bx, by) in ((29, 14), (33, 14), (29, 18), (33, 18)):
        iso.box(s, bx, by, 0, 1, 1, 1, C['ink'], C['ink'], C['ink'])
    iso.box(s, 31, 15.5, 1, 1.4, 1.4, 6.5, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 28, 13, 7.5, 7, 6.5, 2, C['pillow2'], shade(C['pillow2'], 0.85), shade(C['pillow2'], 0.72))
    s = furn('chair_back', (28, 19.5, 35, 21))
    iso.box(s, 31, 19.5, 9.5, 1.2, 1.2, 4, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 28, 19.5, 13, 7, 1.6, 9, C['pillow2'], shade(C['pillow2'], 0.85), shade(C['pillow2'], 0.72))

    # sofa (base+back+rear arm), front arm separately
    s = furn('sofa', (0, 24, 12, 39))
    iso.box(s, 0, 24, 0, 12, 18, 3, C['wood_d'], C['wood_d'], shade(C['wood_d'], 0.8))
    iso.box(s, 0, 24, 3, 12, 18, 5, C['sofa'], C['sofa_d'], shade(C['sofa_d'], 0.85))
    iso.box(s, 0, 24, 8, 4, 18, 10, C['sofa_l'], C['sofa_d'], C['sofa'])
    iso.box(s, 4, 24, 8, 8, 3, 5, C['sofa_l'], C['sofa_d'], C['sofa'])
    iso.box(s, 4, 33, 8, 7, 0.1, 0.1, C['sofa_d'], C['sofa_d'], C['sofa_d'])              # cushion seam
    for i in range(14):
        p = P(4 + i * 0.5, 33, 8)
        s.put(p[0], p[1], C['sofa_d'])
    iso.box(s, 4, 26.5, 8, 2.5, 5, 5, C['pillow'], shade(C['pillow'], 0.88), shade(C['pillow'], 0.78))   # pillow
    s = furn('sofa_arm', (0, 39, 12, 42))
    iso.box(s, 0, 39, 8, 12, 3, 5, C['sofa_l'], C['sofa_d'], C['sofa'])
    iso.box(s, 4.5, 36.5, 8, 2.5, 2.5, 4, C['pillow2'], shade(C['pillow2'], 0.88), shade(C['pillow2'], 0.75))

    # tea table with a mug and a book
    s = furn('table', (16, 30, 23, 37))
    iso.box(s, 18.8, 32.8, 0, 1.6, 1.6, 7, C['wood'], C['wood'], C['wood_d'])
    iso.box(s, 17.5, 31.5, 0, 4.2, 4.2, 0.8, C['wood_d'], C['wood_d'], C['wood_d'])
    iso.box(s, 16, 30, 7, 7, 7, 1.5, C['wood_h'], C['wood_l'], C['wood'])
    iso.box(s, 17, 33, 8.5, 3.5, 2.5, 0.8, C['book_c'] if 'book_c' in C else BOOK_COLS[1], BOOK_COLS[1], shade(BOOK_COLS[1], 0.8))
    iso.box(s, 20.5, 31, 8.5, 1.6, 1.6, 2.3, C['white'], C['cream'], shade(C['cream'], 0.85))

    # test bench (the "work rig")
    s = furn('bench', (39, 26, 48, 41))
    for (lx, ly) in ((39.5, 26.5), (46, 26.5), (39.5, 39), (46, 39)):
        iso.box(s, lx, ly, 0, 1.5, 1.5, 12, C['metal'], C['metal'], C['metal_d'])
    iso.box(s, 39.5, 27, 4, 7.5, 12.5, 0.8, C['metal_d'], C['metal_d'], C['metal_d'])     # lower shelf
    iso.box(s, 41, 29, 4.8, 3, 3, 3, C['note_b'], shade(C['note_b'], 0.85), shade(C['note_b'], 0.7))
    iso.box(s, 39, 26, 12, 9, 15, 1.5, C['wood_h'], C['wood_l'], C['wood'])
    # rig box with status panel on its viewer-facing (y-max) side
    iso.box(s, 41.5, 27.5, 13.5, 5.5, 6, 9, C['metal_l'], C['metal'], C['metal_d'])
    iso.box(s, 43, 28.5, 22.5, 1, 1, 4, C['metal_d'], C['metal_d'], C['metal_d'])          # antenna
    p = P(43.5, 29, 27); s.put(p[0], p[1], C['led_r'])
    # test tubes rack
    iso.box(s, 41, 36, 13.5, 5, 2, 1.5, C['wood_l'], C['wood'], C['wood_d'])
    for i, col in enumerate((C['led_g'], C['note_b'], C['note_p'])):
        p = P(42 + i * 1.5, 37, 15)
        s.rect(p[0], p[1] - 4, 1, 4, col); s.put(p[0], p[1] - 5, C['glass'])
    # wrench / screwdriver
    p = P(45.5, 37.5, 13.6)
    s.rect(p[0], p[1], 4, 1, C['metal_l']); s.put(p[0] - 1, p[1], C['led_r'])

    # floor lamp near the sofa
    s = furn('floor_lamp', (1.5, 43, 5, 46.5))
    iso.box(s, 2, 43.5, 0, 3, 3, 1, C['wood_d'], C['wood_d'], C['wood_d'])
    for z in range(1, 27):
        p = P(3.5, 45, z)
        s.put(p[0], p[1], C['wood_d'])
    iso.box(s, 1.5, 43, 26, 4, 4, 6, C['cream'], C['glow'], shade(C['glow'], 0.9))


SCREEN_FACE = (26.5, 3.5, 21, 35.5, 31)   # x0, y(plane), z0, x1, z1 of the monitor's viewer-facing face


def screen_frames():
    """Monitor screen overlays: drawn over the monitor's y-plane face."""
    x0, yp, z0, x1, z1 = SCREEN_FACE
    pts = [P(x0 + 0.5, yp, z1), P(x1, yp, z1), P(x1, yp, z0), P(x0 + 0.5, yp, z0)]

    def mk(fn):
        s = new()
        s.poly(pts, lambda px, py: fn(*plane_y(px, py, yp)))
        return s

    def plane_y(px, py, y):
        x = ((px + 0.5) - iso.ox) / 2 + y
        z = iso.oy + x + y - (py + 0.5)
        return x - x0, z - z0           # u in [0,9], v in [0,10]
    frames = {}
    frames['scr_off'] = mk(lambda u, v: C['screen'] if v > 0.3 else C['screen_l'])
    frames['scr_idle'] = mk(lambda u, v: (C['code1'] if (abs(u - 4.5) < 1.2 and abs(v - 5) < 1.5) else shade(C['screen_l'], 1.1)))
    for f in range(4):
        def code(u, v, f=f):
            line = int(v + f) % 10
            if 0.6 < u < 8.4 and (v % 1.0) > 0.45:
                ind = (line * 7) % 3
                ln = 2 + (line * 5) % 6
                if ind * 0.8 + 0.6 < u < ind * 0.8 + ln:
                    return (C['code1'], C['code2'], C['code3'])[(line + int(u)) % 3]
            return C['screen']
        frames[f'scr_code{f}'] = mk(code)
    for f in range(2):
        frames[f'scr_read{f}'] = mk(lambda u, v, f=f: C['paper'] if 1 < u < 8 and 1 < v < 9.5 and not (int(v * 2 + f) % 3 == 0 and 2 < u < 7) else C['screen_l'])
    frames['scr_err'] = mk(lambda u, v: C['led_r'] if (abs(u - 4.5) < 0.8 and (2.5 < v < 3.5 or 4.5 < v < 8.5)) else shade(C['led_r'], 0.45))
    frames['scr_ok'] = mk(lambda u, v: C['led_g'] if abs((v - 3) - (abs(u - 3.5) * 1.6 if u < 3.5 else (u - 3.5) * 1.2)) < 0.9 and 1.5 < u < 8 else shade(C['led_g'], 0.35))
    frames['scr_wait'] = mk(lambda u, v: C['led_a'] if (abs(u - 4.5) < 0.8 and (2.5 < v < 3.5 or 4.5 < v < 8.5)) else shade(C['led_a'], 0.4))
    return frames


def rig_frames():
    """Status LEDs on the test rig (face y=33.5 plane)."""
    out = {}
    leds = [(42.8, 19.5), (44.5, 19.5), (46.2, 19.5)]
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
        p0 = P(42, 33.5, 21)
        p1 = P(47, 33.5, 21)
        # display strip
        s.poly([P(42, 33.5, 22), P(47, 33.5, 22), P(47, 33.5, 15.5), P(42, 33.5, 15.5)], C['screen'])
        for (lx, lz), col in zip(leds, cols):
            p = P(lx, 33.5, lz)
            s.rect(p[0], p[1], 2, 2, col)
        # gauge bar
        fill = {'rig_idle': 0, 'rig_run0': 1, 'rig_run1': 2, 'rig_run2': 3, 'rig_pass': 4, 'rig_fail': 4}[name]
        bar = C['led_g'] if name != 'rig_fail' else C['led_r']
        for i in range(4):
            p = P(42.6 + i * 1.1, 33.5, 17)
            s.rect(p[0], p[1], 2, 1, bar if i < fill else C['led_off'])
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
                elif best > 0.4 + noise(x, y, seed) * 0.08:
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
    # punch window glass so the sky shows through
    for y in range(SH):
        for x in range(SW):
            if base.px[x, y][3] == 0:
                continue
    win = new()
    win.poly([P(0, 26, 21), P(0, 41, 21), P(0, 41, 42), P(0, 26, 42)], (1, 1, 1, 255))
    for (x, y) in [(x, y) for y in range(SH) for x in range(SW) if win.px[x, y][3]]:
        yy, zz = plane_left(x, y)
        if wall_left_tex(x, y)[3] == 0:
            base.px[x, y] = (0, 0, 0, 0)
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
        'scene': {'w': SW, 'h': SH, 'ox': iso.ox, 'oy': iso.oy, 'room': N, 'floorZ': 3},
        'furniture': furniture,
        'screen': SCREEN_FACE,
        'char': {'w': character.W, 'h': character.H, 'ax': character.W // 2, 'ay': character.H - 1,
                 'agents': list(character.AGENT_LOOKS), 'frames': list(character.FRAMES)},
        'spots': {
            'desk': {'x': 31.5, 'y': 16.5, 'face': 'ur', 'z': 6, 'sit': True},
            'shelf': {'x': 12, 'y': 14, 'face': 'ul'},
            'board': {'x': 10.5, 'y': 6.5, 'face': 'ur'},
            'bench': {'x': 35.5, 'y': 33.5, 'face': 'dr'},
            'sofa': {'x': 6.5, 'y': 32.5, 'face': 'dr', 'z': 5, 'sit': True},
            'center': {'x': 26, 'y': 28, 'face': 'dr'},
            'front': {'x': 27, 'y': 40, 'face': 'dr'},
            'window': {'x': 13.5, 'y': 30, 'face': 'ul'},
            'plantcorner': {'x': 14, 'y': 4, 'face': 'ul'},
        },
        'nodes': {
            'center': [26, 28], 'deskA': [25, 18], 'desk': [31.5, 16.5], 'shelfA': [15, 20], 'shelf': [12, 14],
            'board': [10.5, 6.5], 'bench': [35.5, 33.5], 'sofaA': [14, 26], 'sofaB': [13.5, 32.5], 'sofa': [6.5, 32.5],
            'front': [27, 40], 'window': [13.5, 30], 'plantcorner': [14, 4], 'east': [37, 22],
        },
        'edges': [['center', 'deskA'], ['deskA', 'desk'], ['center', 'shelfA'], ['shelfA', 'shelf'], ['shelf', 'board'],
                  ['board', 'plantcorner'], ['shelf', 'plantcorner'], ['deskA', 'shelfA'],
                  ['center', 'bench'], ['center', 'sofaA'], ['sofaA', 'sofaB'], ['sofaB', 'sofa'], ['sofaB', 'window'],
                  ['sofaA', 'shelfA'], ['center', 'front'], ['front', 'bench'], ['center', 'east'], ['east', 'bench'], ['east', 'deskA']],
        'steam': list(P(21.3, 31.8, 11)),
    }
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump({'frames': frames, 'layout': layout}, f, separators=(',', ':'))
    print('atlas', AW, AH, len(frames), 'sprites')


if __name__ == '__main__':
    main()
