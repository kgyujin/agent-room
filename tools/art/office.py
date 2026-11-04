"""Isometric (2:1) office in a warm storybook palette: cream stone walls with arched
stained-glass windows, ivy, stone pavers with an inlaid star, hydrangea planters,
wooden desks. Everything is drawn per pixel from world coordinates, 1 colour per pixel.

World: x runs down-right, y runs down-left, z up (see pix.Iso). Room footprint X x Y,
wall height Z. Exports the room background, furniture sprites with depth bases,
per-desk screen overlays, rig overlays and the walk graph for the app.
"""
import math
import random

from pix import Spr, Iso, hexc, shade

X, Y, Z = 72, 60, 46
CAP = 3                       # wall thickness (world units)
OX = 2 * Y + 2 * CAP + 6      # screen x of the back corner
OY = Z + CAP + 8              # screen y of the back corner at floor level
SW = OX + 2 * X + 2 * CAP + 6
SH = OY + X + Y + 6
iso = Iso(OX, OY)
P = iso.p

C = {k: hexc(v) for k, v in {
    # stone (walls, pavers, pots)
    'st_hi': '#fbf3e3', 'st_l': '#f1e3c9', 'st': '#e6d2b2', 'st_m': '#d9c19c', 'st_d': '#c4a77f', 'st_dd': '#a3876a', 'st_ln': '#8a6f58',
    'mortar': '#cdb593', 'pv_a': '#ead9bc', 'pv_b': '#e1cdac', 'pv_c': '#f1e4cc', 'pv_d': '#d8c19e', 'inlay': '#cbb08a', 'inlay_l': '#f6ecda',
    # greens
    'g_dd': '#24503a', 'g_d': '#2f6b3f', 'g': '#4a8c43', 'g_l': '#6fb04c', 'g_h': '#a6d468', 'g_ln': '#1d3a2e',
    # hydrangea / flowers
    'hy_b': '#6f86e0', 'hy_bl': '#a9b8f5', 'hy_bd': '#4b5cb8', 'hy_p': '#9a72d6', 'hy_pl': '#c9aef0', 'hy_pd': '#6c4cae',
    'fl_r': '#e86a7a', 'fl_rl': '#ffa3ae', 'fl_rd': '#b84458', 'fl_y': '#f3cf55', 'fl_w': '#fff7ea',
    # glass
    'gl_1': '#9ec3e6', 'gl_2': '#c9b8ea', 'gl_3': '#7d8fd0', 'gl_4': '#e8f2fb', 'gl_5': '#f4c98a', 'lead': '#4f4569',
    # wood
    'w_hi': '#e9b47c', 'w_l': '#cf9460', 'w': '#b07444', 'w_d': '#87532f', 'w_dd': '#5f3a22', 'w_ln': '#4a2c1c',
    # navy + gold (banners, iron)
    'nv': '#3e4486', 'nv_l': '#5a62ae', 'nv_d': '#2b2f63', 'gold': '#ecbf55', 'gold_d': '#c08f2c',
    'iron': '#4a4a64', 'iron_l': '#6c6d8c', 'iron_d': '#30304a', 'lamp': '#fffbe8', 'lamp_g': '#f6eebc',
    # tech
    'cr': '#efe6d6', 'cr_l': '#fbf6ec', 'cr_d': '#d2c4ac', 'scr': '#2d3350', 'scr_l': '#41496e',
    'led_g': '#7be38a', 'led_r': '#ff6b6b', 'led_a': '#ffc864', 'led_off': '#59607a',
    'code1': '#9fe0d8', 'code2': '#f4b9c8', 'code3': '#ffe38a', 'paper': '#fff8ea',
    # soft furnishing
    'sofa': '#7f8fd6', 'sofa_l': '#a3b0ea', 'sofa_d': '#5d6bb4', 'rug': '#b9a2d9', 'rug_l': '#d4c3ec', 'rug_d': '#9a82c2', 'rug_b': '#f3e9fb',
    'cush': '#f2b6c0', 'cush_d': '#d98e9c', 'cork': '#d6a46c', 'cork_d': '#b9874f',
    'note_y': '#ffe88a', 'note_p': '#ffc2cf', 'note_b': '#bfe2f2', 'book1': '#c95f5f', 'book2': '#5f86c9', 'book3': '#e0b450',
    'book4': '#6fa86a', 'book5': '#9a72c2', 'book6': '#e98aa8',
}.items()}

RNG = random.Random(7)


def hsh(*a):
    """deterministic 0..1 hash of integers"""
    h = 2166136261
    for v in a:
        h = (h ^ (int(v) & 0xffffffff)) * 16777619 & 0xffffffff
    return (h >> 8) / (1 << 24)


def to_world(sx, sy, z=0):
    """screen pixel centre -> world (x, y) on the plane at height z"""
    a = (sx + 0.5 - OX) / 2          # x - y
    b = sy + 0.5 - OY + z            # x + y
    return (a + b) / 2, (b - a) / 2


# ---------------------------------------------------------------- floor
def floor_color(x, y):
    # central star medallion (inlaid lighter stone)
    cx, cy = 22, 44
    dx, dy = x - cx, y - cy
    r = math.hypot(dx, dy)
    ang = math.atan2(dy, dx)
    # 4-point star: |cos| profile gives sharp points; outline only, like an inlaid brass line
    star = 4.5 + 7.5 * abs(math.cos(2 * ang)) ** 3
    if abs(r - 12.5) < 0.6 or abs(r - 11) < 0.45 or abs(r - star) < 0.6:
        return C['inlay']
    if r < star:
        return C['inlay_l'] if r < 2.5 else C['pv_c']
    if 11 < r < 12.5:
        return C['pv_d']
    # running-bond pavers 6 x 4 world units
    row = math.floor(y / 4)
    off = 3 if row % 2 else 0
    col = math.floor((x + off) / 6)
    fx, fy = (x + off) % 6, y % 4
    if fx < 0.55 or fy < 0.55:
        return C['mortar'] if (math.floor(x * 2) + math.floor(y * 2)) % 3 else shade(C['mortar'], 0.94)
    t = hsh(row, col)
    base = C['pv_a'] if t < 0.45 else C['pv_b'] if t < 0.75 else C['pv_c'] if t < 0.92 else C['pv_d']
    if fy < 1.1 or fx < 1.1:
        return shade(base, 1.18)    # lit top edge of each paver
    if fy > 3.4:
        return shade(base, 0.95)
    return base


def draw_floor(s):
    pts = [P(0, 0), P(X, 0), P(X, Y), P(0, Y)]
    s.poly(pts, lambda px, py: floor_color(*to_world(px, py)))
    # contact shadow along both walls
    for px, py in s.poly(pts, None) if False else []:
        pass


# ---------------------------------------------------------------- walls
def stone(u, z, lit):
    """cream ashlar: 8 x 6 blocks in running bond, mortar lines, soft per-block tone"""
    if z < 3:
        base = C['st_d'] if z >= 1 else C['st_dd']
        return shade(base, 1.06) if lit else base
    row = math.floor((z - 3) / 6)
    off = 4 if row % 2 else 0
    col = math.floor((u + off) / 8)
    fu, fz = (u + off) % 8, (z - 3) % 6
    if fu < 0.5 or fz < 0.9:
        c = C['st_m']
    else:
        t = hsh(row, col, 3)
        c = C['st_l'] if t < 0.5 else C['st'] if t < 0.85 else C['st_hi']
        if fz > 5.0:
            c = shade(c, 1.05)
    return c if lit else shade(c, 0.93)


# clear glass: left transparent so the app can paint the real-time sky behind it
HOLE = (0, 0, 0, 0)
# screen pixels of each window's clear glass, filled by draw_walls (for the app's sky layer)
WINDOW_PX = {}


def window_color(u, z, u0, w, z0, h):
    """arched window: stained glass in the arch, clear panes below; returns None outside"""
    cx = u0 + w / 2
    r = w / 2
    zt = z0 + h - r
    inside = (u0 <= u < u0 + w and z0 <= z < zt) or (z >= zt and math.hypot(u - cx, z - zt) < r)
    frame = (u0 - 1 <= u < u0 + w + 1 and z0 - 1 <= z < zt) or (z >= zt and math.hypot(u - cx, z - zt) < r + 1)
    if not frame:
        return None
    if not inside:
        return C['st_hi']
    # leading: vertical centre bar, transoms, ring on the arch
    if abs(u - cx) < 0.5 or abs(z - (z0 + h * 0.42)) < 0.5 or (z >= zt and abs(math.hypot(u - cx, z - zt) - r * 0.55) < 0.5):
        return C['lead']
    if z < z0 + 1:
        return C['st_d']
    if z >= zt and math.hypot(u - cx, z - zt) > r * 0.55:
        # stained-glass band round the arch
        k = hsh(math.floor((u - u0) / 2.5), math.floor((z - z0) / 3), 11)
        return C['gl_1'] if k < 0.4 else C['gl_2'] if k < 0.7 else C['gl_3'] if k < 0.88 else C['gl_5']
    return HOLE


def wall_pixel(u, z, wall, at=None):
    lit = wall == 'L'
    # window positions (wall-local u along the wall from the back corner)
    wins = [(34, 11, 14, 26)] if wall == 'L' else [(16, 10, 12, 24), (38, 10, 12, 24)]
    for i, (u0, w, z0, h) in enumerate(wins):
        c = window_color(u, z, u0, w, z0, h)
        if c is HOLE:
            if at:
                WINDOW_PX.setdefault(f'{wall}{i}', set()).add(at)
            return c
        if c is not None:
            return c if lit else shade(c, 0.95)
    # cornice band under the cap
    if z > Z - 2.5:
        return C['st_hi'] if z > Z - 1.2 else C['st_m']
    return stone(u, z, lit)


def draw_walls(s):
    # left wall: plane x = 0, u = y
    s.poly([P(0, 0, Z), P(0, Y, Z), P(0, Y, 0), P(0, 0, 0)],
           lambda px, py: wall_pixel((OX - px - 0.5) / 2, OY + (OX - px - 0.5) / 2 - (py + 0.5), 'L', (px, py)))
    # right wall: plane y = 0, u = x
    s.poly([P(0, 0, Z), P(X, 0, Z), P(X, 0, 0), P(0, 0, 0)],
           lambda px, py: wall_pixel((px + 0.5 - OX) / 2, OY + (px + 0.5 - OX) / 2 - (py + 0.5), 'R', (px, py)))
    # wall caps (thickness), lit tops
    cap = C['st_hi']
    s.poly([P(-CAP, -CAP, Z), P(0, -CAP, Z), P(0, Y, Z), P(-CAP, Y, Z)], cap)
    s.poly([P(-CAP, -CAP, Z), P(X, -CAP, Z), P(X, 0, Z), P(0, 0, Z)], cap)
    # end faces of the caps
    s.poly([P(-CAP, Y, Z), P(0, Y, Z), P(0, Y, 0), P(-CAP, Y, 0)], C['st_d'])
    s.poly([P(X, -CAP, Z), P(X, 0, Z), P(X, 0, 0), P(X, -CAP, 0)], C['st_m'])
    # corner pillar line + cap edges
    for z in range(0, Z):
        x0, y0 = P(0, 0, z)
        s.put(x0, y0, C['st_m'])
    line = C['st_ln']
    for (a, b) in [((-CAP, -CAP, Z), (X, -CAP, Z)), ((-CAP, -CAP, Z), (-CAP, Y, Z)), ((-CAP, Y, Z), (-CAP, Y, 0)),
                   ((X, -CAP, Z), (X, -CAP, 0)), ((-CAP, Y, 0), (0, Y, 0)), ((X, -CAP, 0), (X, 0, 0))]:
        seg(s, P(*a), P(*b), line)
    # soft floor shadow along walls
    for y in range(Y * 2):
        for d in range(3):
            px, py = P(d * 0.7, y / 2)
            c = s.get(px, py)
            if c[3]:
                s.put(px, py, shade(c, 0.9 + d * 0.03))
    for x in range(X * 2):
        for d in range(2):
            px, py = P(x / 2, d * 0.7)
            c = s.get(px, py)
            if c[3]:
                s.put(px, py, shade(c, 0.92 + d * 0.03))


def seg(s, a, b, c):
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
    for i in range(n + 1):
        t = i / n
        s.put(round(a[0] + (b[0] - a[0]) * t - 0.5), round(a[1] + (b[1] - a[1]) * t - 0.5), c)


# ---------------------------------------------------------------- foliage helpers
def blob(s, cx, cy, r, tones, seed=0, ry=None):
    """leafy/flowery round cluster: lit top-left, dark bottom-right, speckled texture"""
    ry = ry or r
    lo, base, hi, hh = tones
    for py in range(int(cy - ry - 1), int(cy + ry + 2)):
        for px in range(int(cx - r - 1), int(cx + r + 2)):
            dx, dy = (px + 0.5 - cx) / r, (py + 0.5 - cy) / ry
            d = dx * dx + dy * dy
            edge = 1 + 0.18 * (hsh(px, py, seed) - 0.5)
            if d > edge:
                continue
            light = -dx * 0.6 - dy * 0.8
            n = hsh(px // 2, py // 2, seed + 5)
            if light + 0.35 * n > 0.75:
                c = hh
            elif light + 0.3 * n > 0.15:
                c = hi
            elif light + 0.3 * n > -0.55:
                c = base
            else:
                c = lo
            s.put(px, py, c)


GREEN = None


def bush(s, cx, cy, w, h, seed=0):
    t = (C['g_d'], C['g'], C['g_l'], C['g_h'])
    k = max(2, int(w / 5))
    for i in range(k):
        ox = cx - w / 2 + (i + 0.5) * w / k
        blob(s, ox, cy - h * 0.35 + (hsh(i, seed) - 0.5) * 2, w / k * 0.75 + 1.5, t, seed + i)
    blob(s, cx, cy - h * 0.6, w * 0.38, t, seed + 9)


def hydrangea(s, cx, cy, w, kind, seed=0):
    tones = {'b': (C['hy_bd'], C['hy_b'], C['hy_bl'], C['fl_w']),
             'p': (C['hy_pd'], C['hy_p'], C['hy_pl'], C['fl_w']),
             'r': (C['fl_rd'], C['fl_r'], C['fl_rl'], C['fl_w'])}[kind]
    # leaves underneath
    blob(s, cx, cy, w * 0.55, (C['g_d'], C['g'], C['g_l'], C['g_h']), seed, ry=w * 0.35)
    n = max(2, int(w / 4))
    for i in range(n):
        fx = cx - w / 2 + 2 + (i + 0.5) * (w - 4) / n
        blob(s, fx, cy - 2 - (i % 2), 2.6, tones, seed + 20 + i)


def ivy(s, pts, seed=0):
    """hanging ivy clusters along a list of screen points"""
    t = (C['g_dd'], C['g_d'], C['g'], C['g_l'])
    for i, (px, py) in enumerate(pts):
        blob(s, px, py, 2.6 + hsh(i, seed) * 1.6, t, seed + i)
        if hsh(i, seed, 3) > 0.55:
            for k in range(int(3 + hsh(i, seed, 4) * 6)):
                s.put(px + (1 if k % 3 == 0 else 0), py + 2 + k, t[1] if k % 2 else t[2])


# ---------------------------------------------------------------- furniture
FURN = []    # (name, Spr, base_y)


def piece(name, base_xy):
    s = Spr(SW, SH)
    FURN.append((name, s, P(*base_xy)[1]))
    return s


def wbox(s, x, y, z, lx, ly, lz, top, left, right):
    return iso.box(s, x, y, z, lx, ly, lz, top, left, right)


def desk(i, x, y):
    """wooden desk with a cream CRT facing +y (towards the sitter, who faces the back wall)"""
    s = piece(f'desk{i}', (x + 14, y + 7))
    # legs
    for (lx, ly) in ((0, 0), (12, 0), (0, 5), (12, 5)):
        wbox(s, x + lx, y + ly, 0, 2, 2, 7, C['w_d'], C['w_dd'], C['w_d'])
    # top slab with grain
    wbox(s, x - 1, y - 1, 7, 16, 9, 2, lambda px, py: C['w_l'] if (py + px // 6) % 4 else C['w'], C['w_d'], C['w'])
    # drawer block on the right
    wbox(s, x + 10, y, 2, 4, 7, 5, C['w'], lambda px, py: C['w_d'] if py % 3 else C['w_dd'], C['w'])
    # monitor on a little stand; the screen is on its +y face, towards the sitter
    wbox(s, x + 5, y + 2, 9, 2, 2, 1.5, C['iron'], C['iron_d'], C['iron'])
    wbox(s, x + 2, y + 2, 10.5, 8, 2, 7, C['cr_l'], C['cr'], C['cr_d'])
    s.poly(screen_poly(x + 2, y + 4, 10.5, 8, 7), lambda px, py: C['scr_l'] if (px + py) % 9 == 0 else C['scr'])
    # keyboard + mug + paper stack
    wbox(s, x + 3, y + 5, 9, 6, 2, 0.6, C['cr'], C['cr_d'], C['cr_d'])
    wbox(s, x + 11, y + 4, 9, 2, 2, 2, C['fl_w'], C['fl_r'], C['fl_rd'])
    wbox(s, x + 0, y + 4, 9, 2, 3, 1, C['paper'], C['cr_d'], C['cr'])
    # stool for the sitter
    st = piece(f'stool{i}', (x + 8, y + 13))
    wbox(st, x + 6, y + 10, 0, 3, 3, 3, C['sofa_l'], C['sofa_d'], C['sofa'])
    return (x + 2, y + 4, 10.5, 8, 7)   # screen: +y face of the monitor


def screen_poly(x, y, z, lx, lz):
    """inner screen area on a +y facing face (the box's 'left' face)"""
    return [P(x + 1, y, z + lz - 1), P(x + lx - 1, y, z + lz - 1), P(x + lx - 1, y, z + 1), P(x + 1, y, z + 1)]


def bookshelf(x0, y0):
    s = piece('shelf', (3, y0 + 14))
    wbox(s, 0, y0, 0, 4, 14, 26, C['w'], C['w_d'], C['w_l'])
    # shelves on the +x face: books
    for row in range(4):
        z0 = 2 + row * 6
        for k in range(13):
            yy = y0 + 0.5 + k
            h = 3 + (hsh(k, row) * 2.5)
            col = [C['book1'], C['book2'], C['book3'], C['book4'], C['book5'], C['book6']][int(hsh(k, row, 2) * 6)]
            for zz in range(int(h)):
                for t in (0, 0.5):
                    px, py = P(4, yy + t, z0 + zz)
                    s.put(px, py, col if zz < h - 1 else shade(col, 1.2))
        for yy in range(y0 * 2, (y0 + 14) * 2):
            px, py = P(4, yy / 2, z0 - 0.5)
            s.put(px, py, C['w_d'])
    return s


def rig(y0):
    """test machine against the left wall; status panel on the +x face"""
    s = piece('rig', (4, y0 + 10))
    wbox(s, 0, y0, 0, 5, 10, 20, C['iron_l'], C['iron'], lambda px, py: C['iron_l'] if (px + py) % 7 else C['iron'])
    wbox(s, 1, y0 + 2, 20, 2, 2, 3, C['led_off'], C['iron_d'], C['iron'])
    wbox(s, 1, y0 + 6, 20, 3, 3, 1, C['iron_l'], C['iron_d'], C['iron'])
    for z in range(1, 20):
        px, py = P(5, y0 + 1, z)
        s.put(px, py, C['iron_d'])
        px, py = P(5, y0 + 9, z)
        s.put(px, py, C['iron_d'])
    # vents
    for z in (3, 5, 7):
        for yy in range(int((y0 + 2) * 2), int((y0 + 8) * 2)):
            px, py = P(5, yy / 2, z)
            s.put(px, py, C['iron_d'])
    return (5, y0 + 2, 11)     # panel origin on the +x face


def board():
    """notice board on the right wall (drawn as part of the wall)"""
    s = piece('board', (66, 1))
    u0, u1, z0, z1 = 52, 66, 14, 30
    for u in range(u0 * 2, u1 * 2):
        for z in range(z0, z1):
            px, py = P(u / 2, 0.3, z)
            edge = u < u0 * 2 + 2 or u >= u1 * 2 - 2 or z < z0 + 1 or z >= z1 - 1
            c = C['w_d'] if edge else C['cork'] if (u + z) % 5 else C['cork_d']
            s.put(px, py, c)
    for (uu, zz, col) in ((54, 24, 'note_y'), (58, 26, 'paper'), (62, 23, 'note_p'), (55, 18, 'note_b'), (60, 17, 'note_y')):
        for du in range(6):
            for dz in range(4):
                px, py = P(uu + du / 2, 0.3, zz - dz)
                s.put(px, py, C[col] if dz else shade(C[col], 0.85))
        px, py = P(uu + 1.5, 0.3, zz)
        s.put(px, py, C['fl_r'])
    return s


def banner(s, wall, u, z0):
    """navy pennant with a gold diamond, hanging from an iron rod"""
    for k in range(-1, 9):
        q = P(0, u + k / 2, z0 + 1) if wall == 'L' else P(u + k / 2, 0, z0 + 1)
        s.put(q[0], q[1], C['iron'])
    for dz in range(16):
        for k in range(8):
            q = P(0.2, u + k / 2, z0 - dz) if wall == 'L' else P(u + k / 2, 0.2, z0 - dz)
            tip = dz >= 13 and abs(k - 3.5) > (15 - dz) * 1.4
            if tip:
                continue
            col = C['nv'] if 1 <= k <= 6 else C['nv_d']
            if k == 1 and dz < 12:
                col = C['nv_l']
            # gold border + diamond emblem
            if dz == 1 or (abs(k - 3.5) + abs(dz - 7) < 3.2 and abs(k - 3.5) + abs(dz - 7) > 1.6):
                col = C['gold']
            if abs(k - 3.5) + abs(dz - 7) <= 1.6:
                col = C['gold_d']
            s.put(q[0], q[1], col)


def lamp(x, y, name):
    s = piece(name, (x + 2, y + 2))
    wbox(s, x, y, 0, 2, 2, 2, C['iron_l'], C['iron'], C['iron_d'])
    for z in range(2, 20):
        px, py = P(x + 1, y + 1, z)
        s.put(px - 1, py, C['iron'])
        s.put(px, py, C['iron_d'])
    wbox(s, x - 0.5, y - 0.5, 20, 3, 3, 5, C['lamp'], C['lamp_g'], C['lamp_g'])
    wbox(s, x - 1, y - 1, 25, 4, 4, 1, C['iron_l'], C['iron'], C['iron_d'])
    px, py = P(x + 1, y + 1, 27)
    s.put(px - 1, py, C['iron'])
    s.put(px, py - 1, C['iron'])
    return s


def planter(name, x, y, kind, w=7):
    s = piece(name, (x + w, y + w))
    wbox(s, x, y, 0, w, w, 5, C['st_m'], C['st'], C['st_d'])
    wbox(s, x - 0.5, y - 0.5, 5, w + 1, w + 1, 1, C['st_hi'], C['st_l'], C['st_m'])
    cx, cy = P(x + w / 2, y + w / 2, 7)
    if kind == 'tree':
        for z in range(6, 16):
            px, py = P(x + w / 2, y + w / 2, z)
            s.put(px, py, C['w_d'])
            s.put(px - 1, py, C['w'])
        t = (C['g_d'], C['g'], C['g_l'], C['g_h'])
        blob(s, cx, cy - 13, 9, t, x + y, ry=7)
        blob(s, cx - 5, cy - 9, 6, t, x + y + 1, ry=5)
        blob(s, cx + 5, cy - 9, 6, t, x + y + 2, ry=5)
        blob(s, cx, cy - 20, 6, t, x + y + 3, ry=5)
    else:
        hydrangea(s, cx, cy - 1, 4 * w * 0.55 + 4, kind, seed=x * 3 + y)
    return s


def sofa(x, y):
    """two-seat sofa facing +x (towards the viewer's lower right) in the lounge"""
    s = piece('sofa', (x + 8, y + 16))
    wbox(s, x, y, 0, 8, 16, 4, C['sofa'], C['sofa_d'], C['sofa_d'])          # base
    wbox(s, x, y, 4, 3, 16, 7, C['sofa_l'], C['sofa_d'], C['sofa'])           # back
    wbox(s, x + 3, y, 4, 5, 2, 4, C['sofa_l'], C['sofa_d'], C['sofa'])        # arms
    wbox(s, x + 3, y + 14, 4, 5, 2, 4, C['sofa_l'], C['sofa_d'], C['sofa'])
    wbox(s, x + 3, y + 2, 4, 5, 12, 1, C['sofa_l'], C['sofa'], C['sofa'])     # seat cushion
    wbox(s, x + 3, y + 3, 5, 2, 3, 3, C['cush'], C['cush_d'], C['cush'])      # pillow
    return s


def table(x, y):
    s = piece('table', (x + 6, y + 6))
    wbox(s, x + 2, y + 2, 0, 2, 2, 4, C['w_d'], C['w_dd'], C['w_d'])
    wbox(s, x, y, 4, 6, 6, 1.5, C['w_l'], C['w_d'], C['w'])
    wbox(s, x + 2, y + 2, 5.5, 2, 2, 2, C['fl_w'], C['cr'], C['cr_d'])        # tea cup
    return P(x + 3, y + 3, 8)


def rug(s, cx, cy, rx, ry):
    for py in range(SH):
        for px in range(SW):
            x, y = to_world(px, py)
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d < 1:
                c = C['rug_d'] if d > 0.82 else C['rug_b'] if 0.62 < d < 0.7 else C['rug'] if d > 0.3 else C['rug_l']
                s.put(px, py, c)


# ---------------------------------------------------------------- build
DESKS = [(16, 4), (38, 4), (16, 25), (38, 25)]
SHELF_Y = 6
RIG_Y = 24
LOUNGE = (50, 36)


def build():
    room = Spr(SW, SH)
    draw_floor(room)
    draw_walls(room)
    rug(room, 59, 46, 10, 11)
    # wall decor painted into the background
    banner(room, 'L', 26, 40)
    banner(room, 'L', 50, 40)
    banner(room, 'R', 4, 40)
    banner(room, 'R', 48, 40)
    # ivy draping over the wall caps
    ivy(room, [P(-1, y, Z + 1) for y in range(2, Y, 4)][:3] + [P(-1, y, Z + 1) for y in range(44, Y, 3)], seed=3)
    ivy(room, [P(x, -1, Z + 1) for x in range(0, 9, 3)] + [P(x, -1, Z + 1) for x in range(64, X, 3)], seed=8)

    screens = [desk(i, x, y) for i, (x, y) in enumerate(DESKS)]
    bookshelf(0, SHELF_Y)
    rig_panel = rig(RIG_Y)
    board()
    sofa(*LOUNGE)
    tea = table(LOUNGE[0] + 11, LOUNGE[1] + 5)
    planter('plantA', X - 7, 2, 'tree', 5)
    planter('plantB', 1, Y - 7, 'tree', 5)
    planter('flowerA', X - 7, 36, 'p', 5)
    planter('flowerB', 1, 38, 'b', 5)
    planter('flowerC', X - 8, Y - 8, 'r', 6)
    planter('flowerD', 22, Y - 6, 'b', 5)
    lamp(X - 4, 26, 'lampA')
    lamp(13, Y - 3, 'lampB')

    for name, s, base in FURN:
        s.outline(factor=0.5)
    return room, screens, rig_panel, tea


def window_boxes():
    """bounding box [x, y, w, h] of each window's clear glass that is still see-through"""
    out = []
    for key in sorted(WINDOW_PX):
        pts = WINDOW_PX[key]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        out.append([min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1])
    return out


def walk_graph(screens):
    """grid of free floor points (screen coords) + named spots, 8-connected"""
    blocked = []
    for (x, y) in DESKS:
        blocked.append((x - 2, y - 2, x + 16, y + 9))
    blocked += [(0, SHELF_Y - 1, 6, SHELF_Y + 15), (0, RIG_Y - 1, 7, RIG_Y + 11), (LOUNGE[0] - 1, LOUNGE[1] - 1, LOUNGE[0] + 9, LOUNGE[1] + 17),
                (LOUNGE[0] + 10, LOUNGE[1] + 4, LOUNGE[0] + 18, LOUNGE[1] + 12), (X - 10, 1, X, 10), (0, Y - 9, 9, Y),
                (X - 8, 35, X, 42), (0, 37, 7, 44), (X - 9, Y - 9, X, Y), (21, Y - 7, 28, Y), (X - 6, 24, X, 30), (24, 14, 30, 20)]

    def free(x, y):
        if not (2 <= x <= X - 2 and 2 <= y <= Y - 2):
            return False
        return not any(a <= x <= c and b <= y <= d for (a, b, c, d) in blocked)

    nodes, wpos = {}, {}
    G = 4
    for gx in range(2, X, G):
        for gy in range(2, Y, G):
            if free(gx, gy):
                k = f'g{gx}_{gy}'
                wpos[k] = (gx, gy)
    edges = []
    for k, (x, y) in wpos.items():
        for dx, dy in ((G, 0), (0, G), (G, G), (G, -G)):
            n = f'g{x + dx}_{y + dy}'
            if n in wpos and free(x + dx / 2, y + dy / 2):
                edges.append([k, n])

    spots = {}

    def spot(name, wx, wy, face, z=0, sit=False):
        sx, sy = P(wx, wy)
        spots[name] = {'x': sx, 'y': sy, 'face': face, **({'z': z, 'sit': True} if sit else {})}
        wpos[name] = (wx, wy)
        best = sorted((k for k in wpos if k.startswith('g')), key=lambda k: (wpos[k][0] - wx) ** 2 + (wpos[k][1] - wy) ** 2)[:2]
        for b in best:
            edges.append([name, b])

    for i, (x, y) in enumerate(DESKS):
        spot(f'desk{i}', x + 7, y + 12, 'ur', z=4, sit=True)
    # waiting / calling spots out in the open, facing the viewer
    for i, (fx, fy) in enumerate(((26, 44), (34, 48), (20, 51), (42, 53))):
        spot(f'front{i}', fx, fy, 'dr')
    spot('shelf', 8, SHELF_Y + 7, 'ul')
    spot("bench", 9, RIG_Y + 6, "ul")
    spot('board', 59, 7, 'ur')
    for k, dy in enumerate((4, 11)):
        spot(f'sofa{k}', LOUNGE[0] + 5, LOUNGE[1] + dy + 1, 'dr', z=4, sit=True)
    spot('sofa2', LOUNGE[0] + 4, LOUNGE[1] + 20, 'dr')
    spot('sofa3', LOUNGE[0] + 13, LOUNGE[1] + 18, 'dl')
    spot('window', 8, 40, 'ul')
    spot('plantcorner', 44, 50, 'dr')
    spot('center', 26, 40, 'dr')
    for k, (x, y) in wpos.items():
        nodes[k] = list(P(x, y))
    return nodes, edges, spots
