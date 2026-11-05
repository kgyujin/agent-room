"""Generates every pixel-art asset for Agent Room (deterministic; run `python3 gen_art.py`).

Outputs to app/public/assets/:
  atlas.png / atlas.json   - all sprites + scene layout (furniture boxes, spots, overlay positions)
"""
import json
import os

from PIL import Image

from pix import Spr, hexc, shade

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
    'outline': '#3b2a2e', 'frame': '#7a5a62', 'walltop': '#9a7480', 'walltop_l': '#b8929c',
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
import office


def face_frames(poly, to_uv, fn):
    """fills a screen-space polygon with fn(u, v) using face-local coordinates"""
    sp = Spr(office.SW, office.SH)
    sp.poly(poly, lambda px, py: fn(*to_uv(px, py)))
    return sp


def desk_screens(i, scr):
    """states of the sheet lying on desk i: u runs along the sheet's long side (world y), v across it"""
    x0, y0, z0, lx, ly = scr
    P = office.P

    def to_uv(px, py):
        wx, wy = office.to_world(px, py, z0)
        return int((wy - y0) * 2), int((wx - x0) * 2)

    poly = [P(x0 + 0.5, y0 + 0.5, z0), P(x0 + lx - 0.5, y0 + 0.5, z0), P(x0 + lx - 0.5, y0 + ly - 0.5, z0), P(x0 + 0.5, y0 + ly - 0.5, z0)]
    W, H = int(ly * 2), int(lx * 2)

    def glyph(rows, col, bg):
        gh, gw = len(rows), len(rows[0])
        ou, ov = (W - gw) // 2, (H - gh) // 2
        return lambda u, v: col if 0 <= v - ov < gh and 0 <= u - ou < gw and rows[v - ov][u - ou] == 'x' else bg

    C2 = office.C
    paper, ink = C2['paper'], C2['nv_d']
    big = lambda rows: [''.join(ch * 2 for ch in r) for r in rows for _ in (0, 1)]   # each mark 2 x 2
    out = {'off': lambda u, v: paper,
           'idle': glyph(big(['x.x', 'xxx', '.x.']), C2['fl_r'], paper),
           'err': glyph(big(['x.x', '.x.', 'x.x']), C2['fl_rd'], paper),
           'ok': glyph(big(['..x', 'x.x', '.x.']), C2['g_d'], paper),
           'wait': glyph(big(['x', 'x', '.', 'x']), C2['gold_d'], paper)}
    # writing: lines of pencil and ink appear one by one, a little more each frame
    for f in range(4):
        def write(u, v, f=f):
            line = (v - 2) // 3
            if v < 2 or (v - 2) % 3 != 0 or line > f:
                return paper
            ind = 2 + (line * 5) % 4
            ln = 6 + (line * 7) % 7
            return (ink, C2['w_dd'], C2['fl_rd'])[line % 3] if ind <= u < ind + ln else paper
        out[f'code{f}'] = write
    for f in range(2):
        out[f'read{f}'] = lambda u, v, f=f: C2['w_d'] if 2 < u < W - 2 and v % 3 == 1 + f else paper
    return {f'scr{i}_{k}': face_frames(poly, to_uv, fn) for k, fn in out.items()}


def rig_overlays(panel):
    xf, y0, z0 = panel
    C2 = office.C
    states = {
        'rig_idle': [C2['led_a'], C2['led_off'], C2['led_off']],
        'rig_run0': [C2['led_a'], C2['led_off'], C2['led_off']],
        'rig_run1': [C2['led_off'], C2['led_a'], C2['led_off']],
        'rig_run2': [C2['led_off'], C2['led_off'], C2['led_a']],
        'rig_pass': [C2['led_g'], C2['led_g'], C2['led_g']],
        'rig_fail': [C2['led_r'], C2['led_r'], C2['led_r']],
    }
    poly = [office.P(xf, y0, z0 + 7), office.P(xf, y0 + 6, z0 + 7), office.P(xf, y0 + 6, z0), office.P(xf, y0, z0)]

    def to_uv(px, py):
        yw = xf - (px + 0.5 - office.OX) / 2
        z = office.OY + xf + yw - (py + 0.5)
        return int((yw - y0) * 2), int(z0 + 7 - z)

    out = {}
    for name, cols in states.items():
        fill = {'rig_idle': 0, 'rig_run0': 1, 'rig_run1': 2, 'rig_run2': 3, 'rig_pass': 3, 'rig_fail': 3}[name]
        bar = C2['led_r'] if name == 'rig_fail' else C2['led_g']
        slate, dark = C2['w_dd'], C2['w_d']

        def fn(u, v, cols=cols, fill=fill, bar=bar):
            k = (u - 1) // 4
            if 1 <= v <= 2 and 0 <= k < 3 and (u - 1) % 4 < 2:
                return dark if cols[k] == C2['led_off'] else cols[k]
            if v == 4 and 0 <= k < 3 and (u - 1) % 4 < 3:
                return bar if k < fill else dark
            return slate
        out[name] = face_frames(poly, to_uv, fn)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    sprites = {}   # name -> (Spr, dx, dy)   dx,dy = placement in scene coordinates (or 0,0)

    room, screens, rig_panel, tea = office.build()
    sprites['room'] = (room, 0, 0)
    furniture = []
    for (name, s, base_y, box) in sorted(office.FURN, key=lambda f: f[2]):
        c, x, y = s.crop()
        sprites[name] = (c, x, y)
        furniture.append({'name': name, 'base': base_y, 'box': box})
    overlays = {}
    for i, scr in enumerate(screens):
        overlays.update(desk_screens(i, scr))
    overlays.update(rig_overlays(rig_panel))
    for name, s in overlays.items():
        c, x, y = s.crop()
        sprites[name] = (c, x, y)

    for name, s in small_fx().items():
        sprites[name] = (s, 0, 0)
    for icon in ('bang', 'ask', 'check', 'cross', 'dots', 'note', 'heart', 'gear', 'book', 'zzz'):
        sprites['bubble_' + icon] = (bubble(icon), 0, 0)

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

    nodes, edges, spots = office.walk_graph(screens)
    layout = {
        'scene': {'w': office.SW, 'h': office.SH},
        'furniture': furniture,
        'desks': len(screens),
        'deskOrder': office.DESK_ORDER,
        'spots': spots,
        'nodes': nodes,
        'edges': edges,
        'steam': list(tea),
        'windows': office.window_boxes(),
        # wall of each window ('L' = plane x = 0, 'R' = plane y = 0) and the screen point of the back floor corner,
        # so the app can place the view outside at a fixed height along each wall
        'windowWalls': [k[0] for k in sorted(office.WINDOW_PX)],
        'wallOrigin': [office.OX, office.OY],
        'clock': office.clock_origin(),
    }
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump({'frames': frames, 'layout': layout}, f, separators=(',', ':'))
    print('atlas', AW, AH, len(frames), 'sprites')


if __name__ == '__main__':
    main()
