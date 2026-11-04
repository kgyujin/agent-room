"""Generates every pixel-art asset for Agent Room (deterministic; run `python3 gen_art.py`).

Outputs to app/public/assets/:
  atlas.png / atlas.json   - all sprites + scene layout (furniture boxes, spots, overlay positions)
"""
import json
import os

from PIL import Image

from pix import Spr, hexc, shade
import character

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

C.update({k: hexc(v) for k, v in {
    'outline': '#3b2a2e', 'frame': '#101018', 'walltop': '#4a4262', 'walltop_l': '#6c6488',
    'wp': '#cfeae0', 'wp_s': '#bfe1d5', 'wp_d': '#a8d2c4', 'crown': '#fff6ea',
    'wains': '#ebc18d', 'wains_d': '#c99a66', 'wains_l': '#f6d8ae', 'base': '#8a5a40',
    'fl_a': '#efc48e', 'fl_b': '#e6b87f', 'fl_c': '#f3cd9c', 'fl_seam': '#c99764', 'fl_sh': '#cf9d68',
    'rug': '#e8705f', 'rug_d': '#c95549', 'rug_b': '#fff1d6', 'rug_p': '#ffd36b',
    'mat': '#86c46f', 'mat_d': '#649f55', 'step': '#8a7270',
    'sky1': '#8fd0ee', 'sky2': '#b3e0f4', 'sky3': '#d8f0f8', 'curtain': '#f6a8b8', 'curtain_d': '#e0889c',
    'chair': '#e0675c', 'chair_d': '#b84f47', 'chair_l': '#f08e83',
    'teal': '#6cbcb0', 'teal_d': '#4f9a90', 'teal_l': '#9ad8cc',
    'bean': '#f7d06a', 'bean_d': '#e0ae45', 'bean_l': '#fde39c',
    'blanket': '#5b8fe0', 'blanket_d': '#4371c0', 'blanket_l': '#7eaaf0', 'tv': '#5c6072',
    'bezel': '#f2ede4', 'bezel_d': '#cfc6b8', 'mach': '#b9c3d6', 'mach_d': '#8f9ab0', 'mach_l': '#d9e0ec',
}.items()})

# Front top-down (3/4) room on a 16px tile grid. World coordinates = scene pixels.
SW, SH = 204, 180
IN_X0, IN_X1 = 6, 198          # inner area inside the frame
WALL_Y0, FLOOR_Y0, FLOOR_Y1 = 6, 62, 174


def new():
    return Spr(SW, SH)


def block(s, x, y, w, top_h, front_h, top, front):
    """furniture block: top face (lit edge on its first row) over a front face (dark last row)"""
    s.rect(x, y, w, top_h, top)
    s.rect(x, y, w, 1, shade(top, 1.18))
    s.rect(x, y + top_h, w, front_h, front)
    s.rect(x, y + top_h + front_h - 1, w, 1, shade(front, 0.85))


def draw_room(s):
    s.rect(0, 0, SW, SH, C['frame'])
    # top of the back wall seen from above
    s.rect(IN_X0, 1, IN_X1 - IN_X0, WALL_Y0 - 1, C['walltop'])
    s.rect(IN_X0, 1, IN_X1 - IN_X0, 1, C['walltop_l'])
    # wall: crown, striped wallpaper with a dot motif, chair rail, wainscot panels, baseboard
    for y in range(WALL_Y0, FLOOR_Y0):
        for x in range(IN_X0, IN_X1):
            if y < WALL_Y0 + 2:
                c = C['crown']
            elif y < 46:
                c = C['wp_s'] if x % 12 in (0, 1) else C['wp']
                if x % 12 == 7 and (y - 8) % 12 in (5,):
                    c = C['wp_d']
                if y == WALL_Y0 + 2:
                    c = C['wp_d']
            elif y == 46:
                c = C['wains_d']
            elif y < 59:
                c = C['wains_l'] if y == 47 else (C['wains_d'] if (x - IN_X0) % 16 == 15 else C['wains'])
            else:
                c = C['base']
            s.put(x, y, c)
    # floor: two 8px planks per 16px tile, joints staggered by half a tile, lit top edge
    for y in range(FLOOR_Y0, FLOOR_Y1):
        r, v = divmod(y - FLOOR_Y0, 8)
        off = 8 if r % 2 else 0
        for x in range(IN_X0, IN_X1):
            u = (x - IN_X0 + off) % 16
            k = ((x - IN_X0 + off) // 16 + r) % 3
            if v == 7 or u == 15:
                c = C['fl_seam']
            elif v == 0:
                c = C['fl_c']
            else:
                c = (C['fl_a'], C['fl_b'], C['fl_a'])[k]
            if y < FLOOR_Y0 + 2:
                c = C['fl_sh']
            s.put(x, y, c)
    # door gap in the bottom frame + mat
    s.rect(92, FLOOR_Y1, 20, SH - FLOOR_Y1, C['step'])
    s.rect(92, SH - 2, 20, 2, C['frame'])
    s.rect(92, 162, 20, 10, C['mat'])
    s.rect(92, 171, 20, 1, C['mat_d'])
    for x in range(94, 110, 4):
        s.rect(x, 164, 2, 6, C['mat_d'])
    # rug
    rx0, ry0, rw, rh = 66, 100, 72, 46
    s.rect(rx0, ry0, rw, rh, C['rug_d'])
    s.rect(rx0 + 1, ry0 + 1, rw - 2, rh - 2, C['rug_b'])
    s.rect(rx0 + 3, ry0 + 3, rw - 6, rh - 6, C['rug'])
    for y in range(ry0 + 7, ry0 + rh - 6, 8):
        for x in range(rx0 + 7 + ((y - ry0) // 8 % 2) * 4, rx0 + rw - 6, 8):
            s.put(x, y, C['rug_p'])
            s.put(x - 1, y, C['rug_d']); s.put(x + 1, y, C['rug_d'])
            s.put(x, y - 1, C['rug_d']); s.put(x, y + 1, C['rug_d'])
    # window with curtains
    wx0, wy0, ww, wh = 58, 12, 32, 28
    s.rect(wx0, wy0, ww, wh, C['white'])
    for y in range(wy0 + 2, wy0 + wh - 2):
        band = (y - wy0 - 2) * 3 // (wh - 4)
        s.rect(wx0 + 2, y, ww - 4, 1, (C['sky1'], C['sky2'], C['sky3'])[band])
    for (cx, cy, n) in ((wx0 + 7, wy0 + 8, 6), (wx0 + 20, wy0 + 16, 8)):
        s.rect(cx, cy, n, 2, C['white'])
        s.rect(cx + 2, cy - 1, n - 3, 1, C['white'])
    s.rect(wx0 + ww // 2 - 1, wy0, 2, wh, C['white'])
    s.rect(wx0, wy0 + wh // 2 - 1, ww, 2, C['white'])
    s.rect(wx0 - 2, wy0 + wh, ww + 4, 2, C['crown'])
    s.rect(wx0 - 2, wy0 + wh + 2, ww + 4, 1, C['wains_d'])
    for cx in (wx0 - 5, wx0 + ww + 1):
        s.rect(cx, wy0 - 2, 4, wh + 4, C['curtain'])
        s.rect(cx + 1, wy0 - 2, 1, wh + 4, C['curtain_d'])
    s.rect(wx0 - 6, wy0 - 3, ww + 12, 1, C['wood_d'])
    # cork board with notes
    bx0, by0 = 98, 15
    s.rect(bx0, by0, 26, 20, C['wood'])
    s.rect(bx0 + 1, by0 + 1, 24, 18, C['cork'])
    for (nx, ny, c) in ((3, 3, 'note_y'), (11, 2, 'paper'), (17, 4, 'note_p'), (4, 11, 'note_b'), (13, 10, 'note_y')):
        s.rect(bx0 + nx, by0 + ny, 6, 5, C[c])
        s.put(bx0 + nx + 2, by0 + ny, C['led_r'])
        s.rect(bx0 + nx + 1, by0 + ny + 2, 4, 1, shade(C[c], 0.8))
    # clock
    for y in range(9):
        for x in range(9):
            d = (x - 4) ** 2 + (y - 4) ** 2
            if d <= 18:
                s.put(152 + x, 10 + y, C['frame'] if d > 11 else C['white'])
    s.rect(156, 12, 1, 3, C['frame']); s.rect(156, 14, 2, 1, C['frame'])
    # contact shadows on the floor
    for (x0, y0, w) in ((10, 76, 28), (126, 78, 48), (178, 76, 18)):
        s.rect(x0, y0, w, 2, C['fl_sh'])


FURN = []   # (name, spr, base y)


def furn(name, base):
    s = new()
    FURN.append((name, s, base))
    return s


def make_furniture():
    # bookshelf against the wall
    s = furn('bookshelf', 76)
    block(s, 10, 24, 28, 6, 46, C['wood_l'], C['wood'])
    for i, (y0, y1) in enumerate(((32, 44), (46, 58), (60, 72))):
        s.rect(12, y0, 24, y1 - y0, shade(C['wood_d'], 0.85))
        x = 12
        k = i * 3
        while x < 35:
            bw = 2 + (k * 7) % 2
            bh = (y1 - y0) - 1 - (k * 5) % 4
            if (k * 11) % 9 == 4:
                x += 3
                k += 1
                continue
            col = BOOK_COLS[(k * 3 + i) % len(BOOK_COLS)]
            s.rect(x, y1 - bh, bw, bh, col)
            s.rect(x, y1 - bh, 1, bh, shade(col, 1.2))
            s.rect(x, y1 - bh + 2, bw, 1, shade(col, 0.75))
            x += bw
            k += 1
        s.rect(12, y1, 24, 2, C['wood_l'])
    # little plant on top
    s.rect(30, 20, 6, 5, C['pot']); s.rect(30, 20, 6, 1, shade(C['pot'], 1.2))
    for (x, y) in ((31, 17), (33, 15), (34, 18), (32, 19), (29, 18), (35, 16)):
        s.rect(x, y, 2, 2, C['leaf'])
    s.put(33, 15, C['leaf_l']); s.put(29, 18, C['leaf_d'])

    # desk with drawers and an open knee space
    s = furn('desk', 78)
    block(s, 126, 54, 48, 12, 12, C['wood_h'], C['wood_l'])
    s.rect(144, 66, 26, 11, shade(C['wood_d'], 0.8))
    s.rect(170, 66, 4, 12, C['wood_l'])
    for y in (68, 73):
        s.rect(129, y, 12, 1, C['wood'])
        s.rect(134, y + 2, 3, 1, C['wood_d'])
    s.rect(138, 59, 22, 4, C['metal_l']); s.rect(138, 62, 22, 1, C['metal'])
    for x in range(139, 159, 2):
        s.put(x, 60, C['metal'])
    s.rect(164, 57, 4, 5, C['cream']); s.rect(164, 57, 4, 1, C['lamp_d'])

    # monitor (screen overlays are drawn right after it)
    s = furn('monitor', 78.1)
    s.rect(136, 32, 26, 22, C['bezel'])
    s.rect(136, 32, 26, 1, shade(C['bezel'], 1.1))
    s.rect(136, 53, 26, 1, C['bezel_d'])
    s.rect(146, 54, 6, 3, C['bezel_d'])
    s.rect(142, 57, 14, 2, C['bezel'])
    s.put(159, 51, C['led_g'])

    # desk chair seen from behind (covers a seated character's lower body)
    s = furn('chair', 100)
    s.rect(137, 89, 17, 7, C['chair'])
    s.rect(138, 90, 15, 1, C['chair_l'])
    s.rect(137, 95, 17, 1, C['chair_d'])
    s.rect(144, 96, 3, 2, C['metal_d'])
    s.rect(139, 98, 13, 1, C['metal_d'])
    s.put(139, 99, C['ink']); s.put(151, 99, C['ink']); s.put(145, 99, C['ink'])

    # test rig cabinet against the wall
    s = furn('bench', 76)
    block(s, 178, 40, 18, 6, 30, C['mach_l'], C['mach'])
    s.rect(181, 49, 12, 9, C['screen'])
    for y in (62, 65, 68):
        s.rect(181, y, 12, 1, C['mach_d'])
    s.rect(184, 34, 4, 6, C['glass']); s.rect(184, 37, 4, 3, C['code1']); s.rect(185, 32, 2, 2, C['glass'])
    s.rect(190, 37, 3, 3, C['led_a'])

    # bed against the left side (rest spot: the character sits on its edge)
    s = furn('sofa', 148)
    block(s, 10, 96, 32, 3, 7, C['wood_h'], C['wood_l'])
    s.rect(11, 106, 30, 40, C['white'])
    s.rect(15, 107, 22, 8, C['white'])
    s.rect(15, 114, 22, 1, C['bezel_d'])
    s.rect(25, 108, 1, 5, C['bezel_d'])
    s.rect(11, 117, 30, 3, C['crown'])
    s.rect(11, 119, 30, 1, C['bezel_d'])
    s.rect(11, 120, 30, 22, C['blanket'])
    for y in (127, 134):
        s.rect(11, y, 30, 2, C['blanket_l'])
    s.rect(40, 117, 1, 25, C['blanket_d'])
    s.rect(11, 142, 30, 4, C['blanket_d'])
    s.rect(11, 146, 2, 2, C['wood_d']); s.rect(39, 146, 2, 2, C['wood_d'])

    # side table with a mug
    s = furn('table', 138)
    block(s, 48, 122, 14, 6, 3, C['wood_h'], C['wood_l'])
    s.rect(50, 131, 2, 7, C['wood']); s.rect(58, 131, 2, 7, C['wood'])
    s.rect(52, 118, 5, 5, C['cream']); s.rect(52, 118, 5, 1, C['lamp_d']); s.put(57, 120, C['cream'])

    # CRT TV on a low stand with a game console on the shelf
    s = furn('tv', 154)
    block(s, 142, 140, 24, 4, 10, C['wood_h'], C['wood_l'])
    s.rect(146, 146, 16, 6, shade(C['wood_d'], 0.8))
    s.rect(148, 148, 10, 4, C['mach_l']); s.rect(148, 151, 10, 1, C['mach'])
    s.put(156, 149, C['led_r']); s.rect(150, 149, 3, 1, C['mach_d'])
    s.rect(145, 123, 18, 18, C['tv']); s.rect(145, 123, 18, 1, shade(C['tv'], 1.3))
    s.rect(147, 125, 14, 11, C['sky2'])
    for i in range(4):
        s.put(149 + i, 126 + i, C['white'])
    s.rect(147, 135, 14, 1, C['sky1'])
    s.rect(158, 137, 2, 2, C['led_g'])
    s.rect(150, 119, 1, 4, C['tv']); s.rect(158, 120, 1, 3, C['tv'])

    # big plant in the corner
    s = furn('plant', 162)
    s.rect(176, 150, 14, 12, C['pot'])
    s.rect(176, 150, 14, 2, shade(C['pot'], 1.2))
    s.rect(176, 161, 14, 1, C['pot_d'])
    for (cx, cy, r) in ((183, 140, 7), (177, 144, 5), (189, 144, 5), (183, 133, 5)):
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                d = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r)
                if d <= 1:
                    l = (x - cx) * 0.6 + (y - cy)
                    s.put(x, y, C['leaf_l'] if l < -r * 0.5 else C['leaf_d'] if l > r * 0.5 else C['leaf'])


SCREEN = (139, 35, 20, 14)   # x, y, w, h of the monitor's screen
RIG = (181, 49)              # top-left of the rig's status panel


def screen_frames():
    x0, y0, w, h = SCREEN

    def mk(fn):
        s = new()
        for v in range(h):
            for u in range(w):
                s.put(x0 + u, y0 + v, fn(u, v))
        return s

    def glyph(rows, col, bg):
        gh, gw = len(rows), len(rows[0])
        ou, ov = (w - gw) // 2, (h - gh) // 2
        return lambda u, v: col if 0 <= v - ov < gh and 0 <= u - ou < gw and rows[v - ov][u - ou] == 'x' else bg

    frames = {'scr_off': mk(lambda u, v: C['screen_l'] if u + v < 6 else C['screen'])}
    frames['scr_idle'] = mk(glyph(['xx', 'xx'], C['code1'], C['screen_l']))
    for f in range(4):
        def code(u, v, f=f):
            line = (v + f) // 2
            if (v + f) % 2 == 0 and v > 0:
                ind = 2 + (line * 7) % 3 * 2
                ln = 4 + (line * 5) % 8
                if ind <= u < ind + ln:
                    return (C['code1'], C['code2'], C['code3'])[line % 3]
            return C['screen']
        frames[f'scr_code{f}'] = mk(code)
    for f in range(2):
        frames[f'scr_read{f}'] = mk(lambda u, v, f=f: C['seam'] if 3 < u < 16 and (v + f) % 3 == 0 and 2 <= v <= 11 else C['paper'] if 1 < u < 18 else C['screen_l'])
    frames['scr_err'] = mk(glyph(['x...x', '.x.x.', '..x..', '.x.x.', 'x...x'], C['led_r'], shade(C['led_r'], 0.4)))
    frames['scr_ok'] = mk(glyph(['....x', '...x.', 'x.x..', '.x...'], C['led_g'], shade(C['led_g'], 0.35)))
    frames['scr_wait'] = mk(glyph(['x', 'x', 'x', '.', 'x'], C['led_a'], shade(C['led_a'], 0.4)))
    return frames


def rig_frames():
    x0, y0 = RIG
    states = {
        'rig_idle': [C['led_a'], C['led_off'], C['led_off']],
        'rig_run0': [C['led_a'], C['led_off'], C['led_off']],
        'rig_run1': [C['led_off'], C['led_a'], C['led_off']],
        'rig_run2': [C['led_off'], C['led_off'], C['led_a']],
        'rig_pass': [C['led_g'], C['led_g'], C['led_g']],
        'rig_fail': [C['led_r'], C['led_r'], C['led_r']],
    }
    out = {}
    for name, cols in states.items():
        s = new()
        s.rect(x0, y0, 12, 9, C['screen'])
        for i, col in enumerate(cols):
            s.rect(x0 + 2 + i * 3, y0 + 2, 2, 2, col)
        fill = {'rig_idle': 0, 'rig_run0': 1, 'rig_run1': 2, 'rig_run2': 3, 'rig_pass': 3, 'rig_fail': 3}[name]
        bar = C['led_r'] if name == 'rig_fail' else C['led_g']
        for i in range(3):
            s.rect(x0 + 2 + i * 3, y0 + 6, 2, 1, bar if i < fill else C['led_off'])
        out[name] = s
    return out


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
    draw_room(base)
    sprites['room'] = (base, 0, 0)

    make_furniture()
    furniture = []
    for (name, s, base_y) in sorted(FURN, key=lambda f: f[2]):
        s.outline(color=C['outline'])
        c, x, y = s.crop()
        sprites[name] = (c, x, y)
        furniture.append({'name': name, 'base': base_y})
    for name, s in {**screen_frames(), **rig_frames()}.items():
        c, x, y = s.crop()
        sprites[name] = (c, x, y)

    for name, s in small_fx().items():
        sprites[name] = (s, 0, 0)
    for icon in ('bang', 'ask', 'check', 'cross', 'dots', 'note', 'heart', 'gear', 'book', 'zzz'):
        sprites['bubble_' + icon] = (bubble(icon), 0, 0)
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
        'scene': {'w': SW, 'h': SH},
        'furniture': furniture,
        'char': {'w': character.W, 'h': character.H, 'ax': character.W // 2, 'ay': character.H - 1,
                 'agents': list(character.AGENT_LOOKS), 'frames': list(character.FRAMES)},
        'spots': {
            'desk': {'x': 145, 'y': 99, 'face': 'ur', 'z': 5, 'sit': True},
            'shelf': {'x': 24, 'y': 90, 'face': 'ul'},
            'board': {'x': 111, 'y': 72, 'face': 'ur'},
            'bench': {'x': 187, 'y': 90, 'face': 'ur'},
            'sofa': {'x': 26, 'y': 149, 'face': 'dr', 'z': 9, 'sit': True},
            'center': {'x': 100, 'y': 120, 'face': 'dr'},
            'front': {'x': 112, 'y': 152, 'face': 'dr'},
            'window': {'x': 74, 'y': 72, 'face': 'ul'},
            'plantcorner': {'x': 166, 'y': 164, 'face': 'dr'},
        },
        'nodes': {
            'center': [100, 120], 'deskA': [145, 112], 'desk': [145, 99], 'shelfA': [32, 98], 'shelf': [24, 90],
            'board': [111, 72], 'bench': [187, 90], 'benchA': [180, 110], 'sofaA': [62, 158], 'sofaB': [26, 158],
            'sofa': [26, 149], 'front': [112, 152], 'window': [74, 72], 'plantcorner': [166, 164],
        },
        'edges': [['center', 'deskA'], ['deskA', 'desk'], ['center', 'shelfA'], ['shelfA', 'shelf'], ['shelfA', 'window'],
                  ['window', 'board'], ['window', 'center'], ['board', 'center'], ['center', 'benchA'], ['deskA', 'benchA'],
                  ['benchA', 'bench'], ['center', 'sofaA'], ['sofaA', 'sofaB'], ['sofaB', 'sofa'], ['center', 'front'],
                  ['front', 'plantcorner'], ['front', 'sofaA']],
        'steam': [54, 114],
    }
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump({'frames': frames, 'layout': layout}, f, separators=(',', ':'))
    print('atlas', AW, AH, len(frames), 'sprites')


if __name__ == '__main__':
    main()
