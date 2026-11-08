"""Generates every pixel-art asset for Agent Room (deterministic; run `python3 gen_art.py`).

Outputs to app/public/assets/:
  atlas-top.png / atlas-top.json - the room seen top-down: sprites + scene layout
"""
import json
import os

from PIL import Image

from pix import Spr, hexc

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
    # symmetric: 11x9 inside, icon centred with 2px all round vertically, tail on the middle column
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
        "owwwwwwwwwwwo",
        ".ooooowooooo.",
        ".....owo.....",
        "......o......",
    ]
    pal = {'o': C['ink'], 'w': C['white']}
    for y, r in enumerate(body):
        for x, ch in enumerate(r):
            if ch in pal:
                s.put(x, y, pal[ch])
    icons = {
        # asking the user (approval / input) is amber like every other "내 차례" cue; only errors are red
        'bang': (["..x..", "..x..", "..x..", ".....", "..x.."], hexc('#d9922e')),
        'ask': ([".xxx.", "x...x", "...x.", ".....", "..x.."], hexc('#d9922e')),
        'check': (["....x", "...x.", "x.x..", ".x...", "....."], hexc('#4fae62')),
        'cross': (["x...x", ".x.x.", "..x..", ".x.x.", "x...x"], C['led_r']),
        'dots': ([".....", ".....", "x.x.x", ".....", "....."], C['ink']),
        'note': (["..xx.", "..x.x", "..x..", "xxx..", "xx..."], hexc('#e083a2')),
        'heart': ([".x.x.", "xxxxx", "xxxxx", ".xxx.", "..x.."], hexc('#e66b86')),
        'gear': (["x.x.x", ".xxx.", "xx.xx", ".xxx.", "x.x.x"], C['metal_d']),
        # an open book: two pages meeting at the spine
        'book': (["xx...xx", "x.x.x.x", "x..x..x", "x..x..x", "xxxxxxx"], hexc('#c65a5a')),
        # writing (editing code): a pencil, in the "working" teal
        # several colours (e eraser, g ferrule, y/o yellow body and its shade, w sharpened wood, k lead) so it reads as a pencil
        'pencil': (["......ee", ".....eee", "....ggee", "...yygg.", "..yyyo..", ".wyyo...", ".wwo....", "k......."],
                   {'e': hexc('#e8899e'), 'g': hexc('#a6abbb'), 'y': hexc('#f2b93b'), 'o': hexc('#c97a2a'), 'w': hexc('#f6d8ae'), 'k': C['ink']}),
        'zzz': (["xxxxx", "...x.", "..x..", ".x...", "xxxxx"], hexc('#7d86b3')),
    }
    rows, col = icons[icon]
    # one colour for 'x', or a palette for several
    ink = col if isinstance(col, dict) else {'x': col}
    # centred in the 11x9 inside (columns 1..11, rows 1..9)
    x0 = 1 + (11 - len(rows[0])) // 2
    y0 = 1 + (9 - len(rows)) // 2
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in ink:
                s.put(x0 + x, y0 + y, ink[ch])
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
import cottage
import furniture as handmade


def cropped(cv):
    """Cv -> (Spr, x, y) cropped to its pixels"""
    bb = cv.im.getbbox()
    s = Spr(bb[2] - bb[0], bb[3] - bb[1])
    s.im = cv.im.crop(bb)
    s.px = s.im.load()
    return s, bb[0], bb[1]


def build(camera):
    """sprites + layout of the room seen by one camera ('iso' or 'top'); both read cottage's one layout"""
    cottage.set_camera(camera)
    sprites = {}   # name -> (Spr, dx, dy)   dx,dy = placement in scene coordinates (or 0,0)
    room, glass = cottage.shell()
    r = Spr(room.w, room.h)
    r.im = room.im
    r.px = r.im.load()
    sprites['room'] = (r, 0, 0)
    furniture = []
    for name, cv, base, box in sorted(cottage.pieces(), key=lambda p: p[2]):
        s, dx, dy = cropped(cv)
        im = handmade.drawn(name)
        if im is not None:
            # the hand-drawn piece takes the box-built one's place: same frame, same spot
            assert im.size == (s.w, s.h), (name, im.size, (s.w, s.h))
            s.im = im
            s.px = s.im.load()
        sprites[name] = (s, dx, dy)
        furniture.append({'name': name, 'base': base, 'box': box})
    for i, (x, y) in enumerate(cottage.DESKS):
        for st in cottage.SCREEN_STATES:
            sprites[f'scr{i}_{st}'] = cropped(cottage.screen_overlay(x, y, st))
    for st in cottage.RIG_STATES:
        sprites[st] = cropped(cottage.rig_overlay(st))
    for name, s in small_fx().items():
        sprites[name] = (s, 0, 0)
    for icon in ('bang', 'ask', 'check', 'cross', 'dots', 'note', 'heart', 'gear', 'book', 'zzz', 'pencil'):
        sprites['bubble_' + icon] = (bubble(icon), 0, 0)

    nodes, edges, spots = cottage.walk_graph()
    windows, walls = [], []
    for wall in ('L', 'R'):
        b = cottage.boxes_of(glass[wall])
        if b:
            windows.append(b)
            walls.append(wall)
    layout = {
        'camera': camera,
        'scene': {'w': cottage.SW, 'h': cottage.SH},
        'furniture': furniture,
        'desks': len(cottage.DESKS),
        'deskOrder': cottage.DESK_ORDER,
        'spots': spots,
        'nodes': nodes,
        'edges': edges,
        'steam': cottage.steam_point(),
        'windows': windows,
        # wall of each window ('L' = plane x = 0, 'R' = plane y = 0) and the screen point of the back floor corner,
        # so the app can place the view outside at a fixed height along each wall
        'windowWalls': walls,
        'wallOrigin': [cottage.OX, cottage.OY],
    }
    return sprites, layout


def pack(sprites, layout, stem):
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
    atlas.save(os.path.join(OUT, f'{stem}.png'))
    with open(os.path.join(OUT, f'{stem}.json'), 'w') as f:
        json.dump({'frames': frames, 'layout': layout}, f, separators=(',', ':'))
    print(stem, AW, AH, len(frames), 'sprites')


def main():
    os.makedirs(OUT, exist_ok=True)
    pack(*build('top'), 'atlas-top')


if __name__ == '__main__':
    main()
