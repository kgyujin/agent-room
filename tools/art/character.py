"""Character sprite frames, composed from parts (head / torso / arms / legs / props).

All frames are 16x24, authored as fill colours only; a selective outline is added afterwards.
Frames face RIGHT (front = toward viewer & right, back = away from viewer & right); the
renderer mirrors them for the left-facing directions.
"""
from pix import Spr, hexc, shade

W, H = 20, 24
PAD = 2

HEAD_FRONT = [  # cap (r/R, white front panel w, brim q) over hair
    ".....rrrrrr.....",
    "...rrrwwwwrrR...",
    "..rrrwwwwwwrRR..",
    ".rrrrwwwwwwrrRR.",
    ".rrrrrrrrrrrrRR.",
    ".qqqqqqqqqqqqqqq",
    ".hkhhhhhhhhhhkh.",
    ".hkhshhhhhhshkh.",
    ".hksssshsshsskh.",
    ".hsswesssswessh.",
    ".hsseesssseessh.",
    ".hsbbsssmssbbsh.",
    "...SssssssssS...",
]
HEAD_BACK = [
    ".....rrrrrr.....",
    "...rrrrrrrrrR...",
    "..rrrrrrrrrrRR..",
    ".rrrrrrrrrrrrRR.",
    ".rrrrrkkkrrrRRh.",
    ".hhhhhhhhhhhhkh.",
    ".hhhhhhhhhhhhkh.",
    ".hhhhhhhhhhhkkh.",
    ".hhhhhhhhhhhkkh.",
    ".hkhhhhhhhhhkkh.",
    ".hkkhhhhhhhkkkh.",
    "..kkkhhhhhhkkk..",
    "....SssssssS....",
]
TORSO_FRONT = [  # rows 13..19 (hoodie, light from top-left)
    "....cddSSddC....",
    "...cccdxxdcCC...",
    "....cccxcxcC....",
    "....ccccccCC....",
    "....cCCCCCCC....",
    "....ccccccCC....",
    "....ppppppPP....",
]
TORSO_BACK = [
    "....cddddddC....",
    "...ccddddddCC...",
    "....ccdddcCC....",
    "....ccccccCC....",
    "....ccccccCC....",
    "....CCCCCCCC....",
    "....ppppppPP....",
]
LEGS = {
    'stand': [".....pp..pp.....", ".....pP..Pp.....", "....fff..fff...."],
    'stepA': [".....pp..pp.....", ".....pP...ff....", "....fff........."],
    'stepB': [".....pp..pp.....", "....ff...Pp.....", ".........fff...."],
    'sit':   ["...pppppppppp...", "....pp....pp....", "....ff....ff...."],
    'sitback': ["...pppppppppp...", "................", "................"],
    'none':  ["................", "................", "................"],
}

# arm overlays: list of (x, y, key)
def _arm(xs, y0, y1, hand=True, key='c', inner='C'):
    out = []
    for y in range(y0, y1 + 1):
        for i, x in enumerate(xs):
            out.append((x, y, inner if (i == 1) else key))
    if hand:
        for x in xs:
            out.append((x, y1 + 1, 's'))
    return out


ARMS = {
    'down':     _arm([2, 3], 14, 17) + _arm([13, 12], 14, 17),
    'down2':    _arm([2, 3], 15, 17) + _arm([13, 12], 15, 17),
    'wave1':    _arm([2, 3], 14, 17) + [(13, 13, 'c'), (14, 12, 'c'), (15, 11, 'c'), (15, 10, 'c'), (15, 9, 's'), (16, 9, 's')],
    'wave2':    _arm([2, 3], 14, 17) + [(13, 13, 'c'), (14, 12, 'c'), (15, 11, 'c'), (16, 10, 'c'), (16, 9, 's'), (17, 9, 's')],
    'up':       [(2, 13, 'c'), (1, 12, 'c'), (0, 11, 'c'), (0, 10, 'c'), (0, 9, 'c'), (0, 8, 's'), (-1, 8, 's'),
                 (13, 13, 'c'), (14, 12, 'c'), (15, 11, 'c'), (15, 10, 'c'), (15, 9, 'c'), (15, 8, 's'), (16, 8, 's')],
    'up2':      [(2, 13, 'c'), (1, 12, 'c'), (0, 11, 'c'), (-1, 10, 'c'), (-1, 9, 'c'), (-1, 8, 'c'), (-1, 7, 's'), (0, 7, 's'),
                 (13, 13, 'c'), (14, 12, 'c'), (15, 11, 'c'), (16, 10, 'c'), (16, 9, 'c'), (16, 8, 'c'), (16, 7, 's'), (15, 7, 's')],
    'hold':     [(3, 14, 'c'), (3, 15, 'c'), (4, 16, 's'), (12, 14, 'c'), (12, 15, 'c'), (11, 16, 's')],
    'head':     [(2, 13, 'c'), (1, 12, 'c'), (1, 11, 's'), (0, 10, 's'), (13, 13, 'c'), (14, 12, 'c'), (14, 11, 's'), (15, 10, 's')],
    'sip':      _arm([2, 3], 14, 17) + [(12, 14, 'c'), (11, 13, 'c'), (10, 12, 's')],
    # back view
    'bdown':    _arm([2, 3], 14, 17, inner='c') + _arm([13, 12], 14, 17, inner='c'),
    'type1':    [(3, 14, 'c'), (2, 15, 'c'), (3, 16, 'C'), (12, 14, 'c'), (13, 15, 'c'), (12, 16, 'C')],
    'type2':    [(3, 14, 'c'), (2, 15, 'c'), (3, 15, 'C'), (12, 14, 'c'), (13, 16, 'c'), (12, 16, 'C')],
    'type3':    [(3, 14, 'c'), (2, 16, 'c'), (3, 16, 'C'), (12, 14, 'c'), (13, 15, 'c'), (12, 15, 'C')],
    'reach':    _arm([2, 3], 14, 17, inner='c') + [(13, 13, 'c'), (14, 12, 'c'), (15, 11, 'c'), (15, 10, 'c'), (15, 9, 'c'), (15, 8, 'c'), (15, 7, 's'), (16, 7, 's')],
    'reach2':   _arm([2, 3], 14, 17, inner='c') + [(13, 13, 'c'), (14, 12, 'c'), (15, 11, 'c'), (15, 10, 'c'), (15, 9, 'c'), (15, 8, 'c'), (15, 7, 'c'), (15, 6, 's'), (16, 6, 's')],
}

PROPS = {
    'book': [(x, y, 'B') for x in range(4, 12) for y in (15, 16, 17)] + [(x, 15, 'W') for x in (5, 6, 9, 10)] + [(x, 16, 'W') for x in (5, 6, 9, 10)] + [(7, 15, 'K'), (8, 15, 'K'), (7, 16, 'K'), (8, 16, 'K')],
    'book2': [(x, y, 'B') for x in range(4, 12) for y in (15, 16, 17)] + [(x, 15, 'W') for x in (5, 6, 9, 10)] + [(x, 16, 'W') for x in (5, 6, 10)] + [(7, 15, 'K'), (8, 15, 'K'), (7, 16, 'K'), (8, 16, 'K'), (9, 14, 'W'), (8, 14, 'W')],
    'mug_low': [(11, 15, 'M'), (12, 15, 'M'), (11, 16, 'M'), (12, 16, 'M'), (13, 15, 'M'), (11, 14, 'T'), (12, 14, 'T')],
    'mug_up': [(9, 11, 'M'), (10, 11, 'M'), (9, 12, 'M'), (10, 12, 'M'), (11, 11, 'M')],
    'heldbook': [(12, 15, 'B'), (13, 15, 'B'), (12, 16, 'B'), (13, 16, 'B'), (12, 17, 'B'), (13, 17, 'W')],
}


def face(rows, variant):
    rows = [list(r) for r in rows]
    if variant == 'normal':
        return rows

    def clear():
        for y in (9, 10):
            for x in range(3, 13):
                rows[y][x] = 's'
    if variant == 'blink':
        clear()
        for x in (4, 5, 10, 11):
            rows[10][x] = 'e'
    elif variant == 'happy':  # ^ ^
        clear()
        for x, y in ((3, 10), (4, 9), (5, 10), (10, 10), (11, 9), (12, 10)):
            rows[y][x] = 'e'
    elif variant == 'left':
        clear()
        for x, y, k in ((3, 9, 'w'), (4, 9, 'e'), (3, 10, 'e'), (4, 10, 'e'), (9, 9, 'w'), (10, 9, 'e'), (9, 10, 'e'), (10, 10, 'e')):
            rows[y][x] = k
    elif variant == 'right':
        clear()
        for x, y, k in ((5, 9, 'w'), (6, 9, 'e'), (5, 10, 'e'), (6, 10, 'e'), (11, 9, 'w'), (12, 9, 'e'), (11, 10, 'e'), (12, 10, 'e')):
            rows[y][x] = k
    elif variant == 'wide':
        clear()
        for x, y, k in ((4, 9, 'w'), (5, 9, 'w'), (4, 10, 'w'), (5, 10, 'e'), (10, 9, 'w'), (11, 9, 'w'), (10, 10, 'e'), (11, 10, 'w')):
            rows[y][x] = k
        rows[11][7] = 'm'; rows[11][8] = 'm'; rows[12][7] = 'm'; rows[12][8] = 'm'
    elif variant == 'focus':  # looking down at a book/screen
        clear()
        for x in (4, 5, 10, 11):
            rows[10][x] = 'e'
        for x in (4, 5, 10, 11):
            rows[9][x] = 'S'
    return rows


def compose(view, arms, legs, face_v='normal', props=(), lift=0):
    head = HEAD_FRONT if view == 'front' else HEAD_BACK
    head = face(head, face_v) if view == 'front' else [list(r) for r in head]
    torso = TORSO_FRONT if view == 'front' else TORSO_BACK
    grid = [['.'] * W for _ in range(H)]
    for y, r in enumerate(head):
        for x, ch in enumerate(r):
            if ch != '.':
                grid[y][x + PAD] = ch
    for i, r in enumerate(torso):
        for x, ch in enumerate(r):
            if ch != '.':
                grid[13 + i][x + PAD] = ch
    for i, r in enumerate(LEGS[legs]):
        for x, ch in enumerate(r):
            if ch != '.':
                grid[20 + i][x + PAD] = ch
    for (x, y, k) in ARMS[arms]:
        if 0 <= x + PAD < W and 0 <= y < H:
            grid[y][x + PAD] = k
    for p in props:
        for (x, y, k) in PROPS[p]:
            grid[y][x + PAD] = k
    if lift:
        grid = grid[lift:] + [['.'] * W for _ in range(lift)]
    return grid


# frame name -> (view, arms, legs, face, props, lift)
FRAMES = {
    'stand_f0': ('front', 'down', 'stand', 'normal', (), 0),
    'stand_f1': ('front', 'down2', 'stand', 'normal', (), 0),
    'blink_f': ('front', 'down', 'stand', 'blink', (), 0),
    'look_l': ('front', 'down', 'stand', 'left', (), 0),
    'look_r': ('front', 'down', 'stand', 'right', (), 0),
    'walk_f0': ('front', 'down', 'stepA', 'normal', (), 1),
    'walk_f1': ('front', 'down', 'stand', 'normal', (), 0),
    'walk_f2': ('front', 'down', 'stepB', 'normal', (), 1),
    'walk_f3': ('front', 'down', 'stand', 'normal', (), 0),
    'stand_b0': ('back', 'bdown', 'stand', 'normal', (), 0),
    'walk_b0': ('back', 'bdown', 'stepA', 'normal', (), 1),
    'walk_b1': ('back', 'bdown', 'stand', 'normal', (), 0),
    'walk_b2': ('back', 'bdown', 'stepB', 'normal', (), 1),
    'walk_b3': ('back', 'bdown', 'stand', 'normal', (), 0),
    'type_0': ('back', 'type1', 'sitback', 'normal', (), 0),
    'type_1': ('back', 'type2', 'sitback', 'normal', (), 0),
    'type_2': ('back', 'type3', 'sitback', 'normal', (), 0),
    'sitb_idle': ('back', 'bdown', 'sitback', 'normal', (), 0),
    'reach_0': ('back', 'reach', 'stand', 'normal', (), 0),
    'reach_1': ('back', 'reach2', 'stand', 'normal', (), 0),
    'browse_0': ('back', 'type1', 'stand', 'normal', (), 0),
    'browse_1': ('back', 'type3', 'stand', 'normal', (), 0),
    'sit_idle': ('front', 'down', 'sit', 'normal', (), 0),
    'sit_blink': ('front', 'down', 'sit', 'blink', (), 0),
    'sit_tea0': ('front', 'hold', 'sit', 'normal', ('mug_low',), 0),
    'sit_tea1': ('front', 'sip', 'sit', 'happy', ('mug_up',), 0),
    'sit_read0': ('front', 'hold', 'sit', 'focus', ('book',), 0),
    'sit_read1': ('front', 'hold', 'sit', 'focus', ('book2',), 0),
    'sit_sleep': ('front', 'down', 'sit', 'blink', (), 0),
    'read_0': ('front', 'hold', 'stand', 'focus', ('book',), 0),
    'read_1': ('front', 'hold', 'stand', 'focus', ('book2',), 0),
    'carry': ('front', 'down', 'stand', 'normal', ('heldbook',), 0),
    'wave_0': ('front', 'wave1', 'stand', 'normal', (), 0),
    'wave_1': ('front', 'wave2', 'stand', 'normal', (), 0),
    'stretch_0': ('front', 'up', 'stand', 'happy', (), 0),
    'stretch_1': ('front', 'up2', 'stand', 'happy', (), 0),
    'cheer_0': ('front', 'up2', 'stand', 'happy', (), 0),
    'cheer_1': ('front', 'up2', 'stand', 'happy', (), 2),
    'panic_0': ('front', 'head', 'stand', 'wide', (), 0),
    'panic_1': ('front', 'head', 'stand', 'wide', (), 1),
}

BASE_PAL = {
    's': '#f7d4b8', 'S': '#e6aa8f', 'b': '#f4a3a3', 'e': '#2d1e2b', 'w': '#ffffff', 'm': '#b85a64',
    'x': '#fff3df', 'p': '#4e5470', 'P': '#3e4359', 'f': '#3a2b33',
    'B': '#c65a5a', 'W': '#fff8ea', 'K': '#8e3c47', 'M': '#fffaf0', 'T': '#c98e5a',
}

# per-agent look: hoodie + hair + cap. Extend this table to add agents (multi-character mode).
AGENT_LOOKS = {
    'claude': {'c': '#d9825f', 'h': '#5b3b33', 'cap': '#e0574c'},
    'codex': {'c': '#5b97b5', 'h': '#2f2a3d', 'cap': '#3f7fd0'},
    'generic': {'c': '#8fb37a', 'h': '#6a4a3a', 'cap': '#4fae62'},
    'demo': {'c': '#a993d6', 'h': '#7a4f45', 'cap': '#9a7fd6'},
}


def palette(agent):
    look = AGENT_LOOKS[agent]
    pal = {k: hexc(v) for k, v in BASE_PAL.items()}
    c = hexc(look['c'])
    h = hexc(look['h'])
    cap = hexc(look['cap'])
    pal.update({'c': c, 'C': shade(c, 0.82), 'd': shade(c, 1.22), 'h': h, 'H': shade(h, 1.35), 'k': shade(h, 0.75),
                'r': cap, 'R': shade(cap, 0.8), 'q': shade(cap, 0.62)})
    return pal


def render_frame(name, agent):
    view, arms, legs, fv, props, lift = FRAMES[name]
    grid = compose(view, arms, legs, fv, props, lift)
    pal = palette(agent)
    s = Spr(W, H)
    for y in range(H):
        for x in range(W):
            k = grid[y][x]
            if k != '.':
                s.put(x, y, pal[k])
    s.outline(factor=0.42)
    return s
