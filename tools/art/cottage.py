"""The sage-cottage room, drawn from ONE layout by two cameras.

Everything in the room (walls, furniture, spots, walk graph) is defined once in world units:
x runs along the back wall, y away from it (towards the viewer), z up. Two cameras project it:
  'iso' - the app's 2:1 diagonal view: 1 unit on x => (+2, +1) px, on y => (-2, +1) px, z => -1 px
  'top' - a 3/4 top-down view:         1 unit on x => (+2, 0) px,  on y => (0, +2) px,  z => -1 px
so a piece sits in the same place in both, only seen from another angle.

Hard rule: 1 cell = 1 px and every pixel is one opaque colour from PAL (no blending, no AA).
"""
import math
import random

from PIL import Image

PAL = {
    'ink': '#2a2230', 'ink2': '#5a4652',                      # the critters' own outline colour
    'h0': '#86583c', 'h1': '#b27a4f', 'h2': '#d29d67', 'h3': '#e7be88', 'h4': '#f4dbab',   # honey wood
    's0': '#4b6d57', 's1': '#6f9474', 's2': '#9cbb93', 's3': '#c4dab6', 's4': '#e2edd8',   # sage
    'c0': '#d6cab5', 'c1': '#eae1ce', 'c2': '#f7f2e6', 'c3': '#fffdf6',                    # cream
    'r0': '#b6626e', 'r1': '#dc8e95', 'r2': '#efb7b4', 'r3': '#f9dcd6',                    # rose
    'b0': '#5d84b3', 'b1': '#8fb3d8', 'b2': '#c0dcee', 'b3': '#e6f2f7',                    # sky
    'y0': '#d09833', 'y1': '#eec862', 'y2': '#f9e6a1',                                     # butter
    't0': '#a5583e', 't1': '#cd7d57',                                                      # terracotta
    'l0': '#8e7eb4', 'l1': '#c4b8e0',                                                      # lavender
    'g0': '#3d5749', 'g1': '#8f8a86', 'g2': '#cfcac6',                                     # chalkboard, greys
    'n0': '#33405e', 'n1': '#4c5c82',                                                      # screens
    'w0': '#2e8c90', 'w1': '#6cc7bd', 'x0': '#d0605e',                                     # work teal, fail red
}
C = {k: (int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16), 255) for k, v in PAL.items()}

X, Y, Z, CAP = 92, 66, 46, 3

# ---------------------------------------------------------------- cameras
MODE = 'iso'
OX = OY = SW = SH = 0


def set_camera(m):
    global MODE, OX, OY, SW, SH
    MODE = m
    if m == 'iso':
        OX, OY = 2 * Y + 2 * CAP + 6, Z + CAP + 8
        SW, SH = OX + 2 * X + 2 * CAP + 6, OY + X + Y + 10
    else:
        OX, OY = 2 * CAP + 4, Z + 2 * CAP + 6
        SW, SH = OX + 2 * X + 2 * CAP + 4, OY + 2 * Y + 10


def P(x, y, z=0):
    if MODE == 'iso':
        return (OX + 2 * (x - y), OY + (x + y) - z)
    return (OX + 2 * x, OY + 2 * y - z)


def Pi(x, y, z=0):
    a, b = P(x, y, z)
    return int(math.floor(a)), int(math.floor(b))


def floor_y(x, y):
    """screen y of a floor point (used as the draw-order key)"""
    return P(x, y)[1]


def hsh(*a):
    h = 2166136261
    for v in a:
        h = (h ^ (int(v) & 0xffffffff)) * 16777619 & 0xffffffff
    return (h >> 8) / (1 << 24)


# ---------------------------------------------------------------- canvas
class Cv:
    def __init__(s, w=None, h=None):
        s.w, s.h = w or SW, h or SH
        s.im = Image.new('RGBA', (s.w, s.h), (0, 0, 0, 0))
        s.p = s.im.load()

    def px(s, x, y, c):
        if c is not None and 0 <= x < s.w and 0 <= y < s.h:
            s.p[x, y] = C[c]

    def stamp(s, rows, x, y, cm, flip=False):
        w = max(len(r) for r in rows)
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch not in '. ':
                    s.px(x + (w - 1 - i if flip else i), y + j, cm[ch])

    def paste(s, o, x=0, y=0):
        for yy in range(o.h):
            for xx in range(o.w):
                c = o.p[xx, yy]
                if c[3] and 0 <= x + xx < s.w and 0 <= y + yy < s.h:
                    s.p[x + xx, y + yy] = c

    def outline(s, col='ink'):
        add = []
        for yy in range(s.h):
            for xx in range(s.w):
                if s.p[xx, yy][3]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = xx + dx, yy + dy
                    if 0 <= nx < s.w and 0 <= ny < s.h and s.p[nx, ny][3]:
                        add.append((xx, yy))
                        break
        for p in add:
            s.px(*p, col)
        return s


def _bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return int(min(xs)) - 1, int(min(ys)) - 1, int(max(xs)) + 2, int(max(ys)) + 2


def face_top(c, x0, y0, x1, y1, z, fn):
    """horizontal face at height z; fn(x, y) -> colour key or None"""
    a, b, cc, d = _bbox([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)])
    for sy in range(b, d):
        for sx in range(a, cc):
            if MODE == 'iso':
                u = (sx + .5 - OX) / 2
                v = sy + .5 - OY + z
                x, y = (u + v) / 2, (v - u) / 2
            else:
                x, y = (sx + .5 - OX) / 2, (sy + .5 - OY + z) / 2
            if x0 <= x < x1 and y0 <= y < y1:
                c.px(sx, sy, fn(x, y))


def face_front(c, x0, x1, y, z0, z1, fn):
    """vertical face on the plane y = const, facing +y (towards the viewer in both cameras); fn(x, z)"""
    a, b, cc, d = _bbox([P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)])
    for sy in range(b, d):
        for sx in range(a, cc):
            if MODE == 'iso':
                x = (sx + .5 - OX) / 2 + y
                z = OY + x + y - (sy + .5)
            else:
                x = (sx + .5 - OX) / 2
                z = OY + 2 * y - (sy + .5)
            if x0 <= x < x1 and z0 <= z < z1:
                c.px(sx, sy, fn(x, z))


def face_side(c, y0, y1, x, z0, z1, fn):
    """vertical face on the plane x = const, facing +x: seen only by the iso camera; fn(y, z)"""
    if MODE != 'iso':
        return
    a, b, cc, d = _bbox([P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)])
    for sy in range(b, d):
        for sx in range(a, cc):
            y = x - (sx + .5 - OX) / 2
            z = OY + x + y - (sy + .5)
            if y0 <= y < y1 and z0 <= z < z1:
                c.px(sx, sy, fn(y, z))


def k(col):
    return lambda *_: col


def box(c, x, y, z, lx, ly, lz, top, front, side):
    face_front(c, x, x + lx, y + ly, z, z + lz, front if callable(front) else k(front))
    face_side(c, y, y + ly, x + lx, z, z + lz, side if callable(side) else k(side))
    face_top(c, x, y, x + lx, y + ly, z + lz, top if callable(top) else k(top))


# ---------------------------------------------------------------- the one layout (world units)
SHELF = (1, 0, 14, 6, 32)                 # x, y, lx, ly, lz - against the back wall, books facing +y
DESKS = [(16, 3), (4, 26), (22, 26), (40, 26), (58, 26), (76, 26)]
DESK_ORDER = [2, 3, 0, 4, 1, 5]           # who sits where first: the middle before the edges
BENCH = (70, 3)
SOFA = (0, 46)
TEA = (16, 52)
BEAN = (79, 51)
RUG = (52, 54, 14, 9)
PLANTS = [(X - 3, 18), (X - 3, Y - 3), (3, 22)]
# wall fixtures, back wall (y = 0): (u0, width, z0, height)
R_WIN = (34, 14, 14, 28)
R_CHALK = (16, 15, 24, 12)
R_DOOR = (54, 11, 30)
R_PEG = (70, 18, 18, 14)
L_WIN = (48, 14, 14, 28)                  # left wall (x = 0): seen only by the iso camera


# ---------------------------------------------------------------- wall and floor
def floor_col(x, y):
    """basket-weave parquet: 8 x 8 blocks of four 2-unit planks"""
    bx, by = math.floor(x / 8), math.floor(y / 8)
    fx, fy = x - bx * 8, y - by * 8
    t = fy if (bx + by) % 2 == 0 else fx
    if fx < .5 or fy < .5 or t % 2 < .5:
        return 'h2'
    return 'h3'


def wall_col(u, z):
    if z >= Z - 3:
        return 'c3' if z >= Z - 1.5 else 'c2'
    if z >= Z - 4:
        return 's2'
    if z < 13:
        if z < 1.5:
            return 'h1'
        if z >= 12:
            return 'c3'
        if z >= 11:
            return 'c0'
        return 'c1' if u % 3 < .5 else 'c2'
    return 's3'


def arch_inside(u, z, u0, w, z0, h, inset=0):
    r = w / 2 - inset
    uc, zc = u0 + w / 2, z0 + h - w / 2
    if not (u0 + inset <= u < u0 + w - inset and z0 + inset <= z):
        return False
    return z < zc or ((u - uc) / r) ** 2 + ((z - zc) / r) ** 2 <= 1


GLASS = object()   # marker: leave the pixel clear so the app's sky shows through


def window_col(u, z, u0, w, z0, h):
    if not arch_inside(u, z, u0, w, z0, h):
        return None
    if not arch_inside(u, z, u0, w, z0, h, .5):
        return 'ink'
    if not arch_inside(u, z, u0, w, z0, h, 1.5):
        return 'c3'
    if abs(u - (u0 + w / 2)) < .5 or abs(z - (z0 + h * .45)) < .5:
        return 'c3'
    return GLASS


def door_col(u, z, u0, w, h):
    if not (u0 <= u < u0 + w and z < h):
        return None
    if u < u0 + .5 or u >= u0 + w - .5 or z >= h - .5:
        return 'ink'
    if u < u0 + 1.5 or u >= u0 + w - 1.5 or z >= h - 1.5:
        return 'c3'
    if abs(u - (u0 + w - 3)) < .8 and abs(z - h * .45) < .8:
        return 'y1'
    for pz0, pz1 in ((3, h * .42), (h * .5, h - 4)):
        if u0 + 3 <= u < u0 + w - 3 and pz0 <= z < pz1:
            if u < u0 + 3.5 or z >= pz1 - .7:
                return 's0'
            if u >= u0 + w - 3.5 or z < pz0 + .7:
                return 's2'
    return 's1'


def chalk_col(u, z, u0, w, z0, h, done=3):
    if not (u0 <= u < u0 + w and z0 <= z < z0 + h):
        return None
    if u < u0 + .5 or u >= u0 + w - .5 or z < z0 + .5 or z >= z0 + h - .5:
        return 'ink'
    if u < u0 + 1.5 or u >= u0 + w - 1.5 or z >= z0 + h - 1.5:
        return 'h1'
    if z < z0 + 2:
        return 'h3'
    row = (z0 + h - 2.5 - z) / 2.6
    i = math.floor(row)
    if 0 <= i < 4 and (row - i) < .45:
        if u0 + 2.5 <= u < u0 + 4:
            return 's3' if i < done else 'y1'
        if u0 + 5 <= u < u0 + 5 + [9, 7, 10, 6][i]:
            return 'c1' if i < done else 'y2'
    return 'g0'


def peg_col(u, z, u0, w, z0, h):
    if not (u0 <= u < u0 + w and z0 <= z < z0 + h):
        return None
    if u < u0 + .5 or u >= u0 + w - .5 or z < z0 + .5 or z >= z0 + h - .5:
        return 'ink'
    for tu, col, ln in ((u0 + 3, 'g2', 7), (u0 + 6, 'r1', 6), (u0 + 9, 'b1', 5), (u0 + 12, 'g1', 7), (u0 + 15, 'y1', 4)):
        if tu <= u < tu + 1 and z0 + h - 2 - ln <= z < z0 + h - 2:
            return col
        if tu - .5 <= u < tu + 1.5 and z0 + h - 3 <= z < z0 + h - 2:
            return 'ink'
    if (u - u0) % 2 < .5 and (z - z0) % 2 < 1:
        return 'h1'
    return 'h3'


def back_wall(u, z):
    for v in (window_col(u, z, *R_WIN), door_col(u, z, *R_DOOR), chalk_col(u, z, *R_CHALK), peg_col(u, z, *R_PEG)):
        if v is not None:
            return v
    return wall_col(u, z)


def left_wall(u, z):
    v = window_col(u, z, *L_WIN)
    return v if v is not None else wall_col(u, z)


def rug(c):
    cx, cy, rx, ry = RUG
    rings = ['c2', 's3', 'c2', 'r2', 'r3', 's3', 'c1', 'r2', 'c2', 's3']

    def col(x, y):
        d = math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
        if d > 1:
            return None
        return 'ink2' if d > .93 else rings[int(d * 9.6) % len(rings)]
    face_top(c, cx - rx, cy - ry, cx + rx, cy + ry, 0, col)


def shell():
    """walls, floor, rug and wall fixtures; window glass stays clear. Returns (canvas, glass pixels per window)."""
    c = Cv()
    glass = {'R': set(), 'L': set()}

    def wall(fn, key):
        def f(u, z):
            v = fn(u, z)
            return v
        return f
    face_top(c, 0, 0, X, Y, 0, lambda x, y: 'h1' if (x < 1 or y < 1) else floor_col(x, y))

    def paint_wall(face, fn, key):
        # rasterise once to find glass pixels, then paint the rest
        probe = {}

        class Rec:
            def px(self, sx, sy, v):
                probe[(sx, sy)] = v
        face(Rec(), fn)
        for (sx, sy), v in probe.items():
            if v is GLASS:
                glass[key].add((sx, sy))
            else:
                c.px(sx, sy, v)
    paint_wall(lambda r, fn: face_front(r, 0, X, 0, 0, Z, fn), back_wall, 'R')
    if MODE == 'iso':
        paint_wall(lambda r, fn: face_side(r, 0, Y, 0, 0, Z, fn), left_wall, 'L')
    # wallpaper motif: tiny cream flowers with a rose centre
    for j, z in enumerate(range(17, Z - 6, 7)):
        for u in range(3 + (4 if j % 2 else 0), X - 2, 8):
            if all(back_wall(u + d, z + d) == 's3' for d in (-1, 0, 1)):
                sx, sy = Pi(u, 0, z)
                c.stamp(['.C.', 'CRC', '.C.'], sx - 1, sy - 1, {'C': 's4', 'R': 'r2'})
        if MODE == 'iso':
            for u in range(3 + (4 if j % 2 else 0), Y - 2, 8):
                if all(left_wall(u + d, z + d) == 's3' for d in (-1, 0, 1)):
                    sx, sy = Pi(0, u, z)
                    c.stamp(['.C.', 'CRC', '.C.'], sx - 1, sy - 1, {'C': 's4', 'R': 'r2'})
    # wall caps (CAP thick) and their open ends; the top camera also frames the right side
    if MODE == 'iso':
        face_top(c, -CAP, -CAP, X, 0, Z, lambda x, y: 'c3' if y < -CAP + 1 else 'c1')
        face_top(c, -CAP, 0, 0, Y, Z, lambda x, y: 'c3' if x < -CAP + 1 else 'c1')
        face_side(c, -CAP, 0, X, 0, Z, k('c0'))
        face_front(c, -CAP, 0, Y, 0, Z, k('c1'))
        face_front(c, -CAP, X, Y, -4, 0, lambda u, z: 's0' if z < -3 else 's1' if u % 6 > .7 else 's0')
        face_side(c, -CAP, Y, X, -4, 0, lambda u, z: 's0' if z < -3 else 's2' if u % 6 > .7 else 's1')
    else:
        face_top(c, -CAP, -CAP, X + CAP, 0, Z, lambda x, y: 'c3' if y < -CAP + 1 else 'c1')
        face_top(c, -CAP, 0, 0, Y, Z, lambda x, y: 'c3' if x < -CAP + 1 else 'c1')
        face_top(c, X, 0, X + CAP, Y, Z, k('c1'))
        face_front(c, -CAP, 0, Y, 0, Z, k('c0'))
        face_front(c, X, X + CAP, Y, 0, Z, k('c0'))
        face_front(c, -CAP, X + CAP, Y, -4, 0, lambda u, z: 's0' if z < -3 else 's1' if u % 6 > .7 else 's0')
    # sills and the door bell
    box(c, R_WIN[0] - 1, 0, R_WIN[2] - 1, R_WIN[1] + 2, 2, 1, 'c3', 'c2', 'c1')
    if MODE == 'iso':
        box(c, 0, L_WIN[0] - 1, L_WIN[2] - 1, 2, L_WIN[1] + 2, 1, 'c3', 'c2', 'c1')
    bx, by = Pi(R_DOOR[0] + R_DOOR[1] / 2, 0, R_DOOR[2] + 4)
    c.stamp(['..O..', '.OYO.', '.OYO.', 'OYHYO', 'OOOOO', '..O..'], bx - 2, by - 3, {'O': 'ink', 'Y': 'y1', 'H': 'y2'})
    # floor things
    rug(c)
    face_top(c, R_DOOR[0], 1, R_DOOR[0] + R_DOOR[1], 6, 0,
             lambda a, b: 'r1' if (a < R_DOOR[0] + 1 or a >= R_DOOR[0] + R_DOOR[1] - 1 or b < 2 or b >= 5) else ('r1' if a % 2 < .7 else 'r2'))
    # outline the room's silhouette (glass is interior, so it stays clear)
    c.outline()
    for key in glass:
        for (sx, sy) in glass[key]:
            c.p[sx, sy] = (0, 0, 0, 0)
    return c, glass


# ---------------------------------------------------------------- furniture
def desk_piece(x, y):
    c = Cv()
    box(c, x, y, 0, 1, 8, 9, 'h3', 'h2', 'h1')
    box(c, x + 13, y, 0, 1, 8, 9, 'h3', 'h2', 'h1')
    box(c, x + 9, y, 0, 4, 8, 9, 'h3',
        lambda u, z: 'ink' if abs(z - 4.5) < .5 else ('y0' if abs(u - (x + 11)) < .6 and 2 < z % 4.5 < 3 else 'h2'), 'h1')
    box(c, x, y, 9, 14, 8, 2, lambda a, b: 'h4' if b > y + 7 else 'h3', 'h2', 'h1')
    box(c, x + 3, y + 2, 11, 6, 4, 1, 'g2', 'g1', 'g1')          # laptop base
    face_front(c, x + 3, x + 9, y + 2, 12, 17,
               lambda u, z: 'g2' if (u < x + 3.5 or u >= x + 8.5 or z < 12.6 or z >= 16.5) else 'n0')
    box(c, x + 11, y + 4, 11, 2, 2, 2, 'h0', 's2', 's1')         # mug
    return c.outline()


SCREEN_STATES = ['off', 'idle', 'err', 'ok', 'wait', 'code0', 'code1', 'code2', 'code3', 'read0', 'read1']


def screen_overlay(x, y, state):
    """the laptop's screen (10 x 4 cells) in one state, drawn where the desk's screen is"""
    c = Cv()
    marks = {
        'idle': ['....', '.x..', '....', '....'],
        'err': ['x.x.', '.x..', 'x.x.', '....'],
        'ok': ['...x', '..x.', 'xx..', '....'],
        'wait': ['.x..', '.x..', '....', '.x..'],
    }
    colours = {'idle': 'w1', 'err': 'x0', 'ok': 's2', 'wait': 'y1'}

    def fn(u, z):
        U = int((u - (x + 3.5)) * 2)
        V = int(16.5 - z)
        if state in marks:
            rows = marks[state]
            mx = U - 3
            return colours[state] if 0 <= mx < 4 and rows[V][mx] == 'x' else 'n0'
        if state.startswith('code'):
            f = int(state[-1])
            ln = [7, 5, 8, 4][V]
            ind = [0, 2, 2, 0][V]
            return ['w1', 'r2', 'y2', 'w1'][V] if V <= f and ind <= U < ind + ln else 'n0'
        if state.startswith('read'):
            f = int(state[-1])
            return 'c1' if (V + f) % 2 == 0 and 1 <= U <= 8 else 'n0'
        return 'n0'
    face_front(c, x + 3.5, x + 8.5, y + 2, 12.6, 16.5, fn)
    return c


def chair_piece(x, y, col):
    c = Cv()
    for lx, ly in ((0, 0), (4, 0), (0, 4), (4, 4)):
        box(c, x + lx, y + ly, 0, 1, 1, 3, 'h2', 'h2', 'h1')
    box(c, x, y, 3, 5, 5, 2, *col)
    return c.outline()


def shelf_piece():
    c = Cv()
    x0, y0, lx, ly, lz = SHELF
    rnd = random.Random(4)
    cols = ['r1', 's1', 'b1', 'y1', 'l0', 't1', 'c2', 's2', 'r2', 'b0']
    book = {}

    def front(u, z):
        if u < x0 + .8 or u >= x0 + lx - .8 or z < 1 or z >= lz - 1:
            return 'h1'
        shelf = math.floor((z - 1) / 7.5)
        fz = (z - 1) - shelf * 7.5
        if fz < 1:
            return 'h3'
        key = (shelf, math.floor(u - x0))
        if key not in book:
            book[key] = (rnd.choice(cols), 4 + rnd.random() * 2.5)
        bc, bh = book[key]
        if shelf == 3:
            return 'h0' if not (x0 + 4 <= u < x0 + 9 and fz < 5) else ('s1' if fz > 2.5 else 't1')
        return bc if fz - 1 < bh else 'h0'
    box(c, x0, y0, 0, lx, ly, lz, 'h3', front, 'h1')
    return c.outline()


RIG_STATES = ['rig_idle', 'rig_run0', 'rig_run1', 'rig_run2', 'rig_pass', 'rig_fail']


def bench_piece():
    x, y = BENCH
    c = Cv()
    for lx, ly in ((0, 0), (15, 0), (0, 7), (15, 7)):
        box(c, x + lx, y + ly, 0, 1, 1, 9, 'h2', 'h2', 'h1')
    box(c, x, y, 3, 16, 8, 1, 'h3', 'h2', 'h1')
    box(c, x + 2, y + 2, 4, 5, 4, 2, 'b2', 'b1', 'b0')
    box(c, x, y, 9, 16, 8, 2, 'h3', 'h2', 'h1')
    box(c, x + 1, y + 1, 11, 9, 5, 7, 's3', 's2', 's1')          # mint test meter
    face_front(c, x + 2, x + 9.5, y + 6, 13, 17, k('n0'))
    box(c, x + 12, y + 3, 11, 1, 1, 3, 'w1', 'w1', 'w0')         # flask
    return c.outline()


def rig_overlay(state):
    x, y = BENCH
    c = Cv()
    wave = {'rig_fail': 'x0', 'rig_pass': 's2'}.get(state, 'w1')
    lamps = {'rig_idle': ['y1', 'n1', 'n1'], 'rig_run0': ['y1', 'n1', 'n1'], 'rig_run1': ['n1', 'y1', 'n1'],
             'rig_run2': ['n1', 'n1', 'y1'], 'rig_pass': ['s2', 's2', 's2'], 'rig_fail': ['x0', 'x0', 'x0']}[state]
    phase = {'rig_run1': 1.2, 'rig_run2': 2.4}.get(state, 0)
    flat = state == 'rig_idle'

    def scr(u, z):
        if flat:
            return 'n1' if abs(z - 15) < .5 else 'n0'
        return wave if abs(z - (15 + 1.4 * math.sin((u - x) * 1.6 + phase))) < .6 else 'n0'
    face_front(c, x + 2, x + 7, y + 6, 13, 17, scr)
    for i, col in enumerate(lamps):
        face_front(c, x + 8, x + 9.5, y + 6, 13.5 + i * 1.2, 14.5 + i * 1.2, k(col))
    return c


def sofa_piece():
    x, y = SOFA
    c = Cv()
    box(c, x, y, 0, 9, 18, 4, 's2', 's0', 's1')
    box(c, x, y, 4, 3, 18, 7, 's2', 's1', 's1')
    box(c, x + 3, y, 4, 6, 3, 4, 's2', 's1', 's1')
    box(c, x + 3, y + 15, 4, 6, 3, 4, 's2', 's1', 's1')
    box(c, x + 3, y + 3, 4, 6, 6, 1, 's3', 's2', 's2')
    box(c, x + 3, y + 9, 4, 6, 6, 1, 's3', 's2', 's2')
    box(c, x + 3, y + 4, 5, 2, 3, 3, 'r3', 'r2', 'r1')
    return c.outline()


def tea_piece():
    x, y = TEA
    c = Cv()
    for lx, ly in ((0, 0), (6, 0), (0, 6), (6, 6)):
        box(c, x + lx, y + ly, 0, 1, 1, 4, 'h2', 'h2', 'h1')
    box(c, x, y, 4, 7, 7, 1, 'c3', 'r1', 'r0')
    box(c, x + 2, y + 2, 5, 3, 3, 3, 'c3', 'c2', 'c1')           # teapot
    box(c, x + 5, y + 1, 5, 1, 1, 1, 's2', 's2', 's1')           # cup
    return c.outline()


BEANBAG = ['.....OOOOOOOOOO.....', '...OOHHHHHHHHHHOO...', '..OHHYYYYYYYYYYHHO..', '.OHYYYYYYYYYYYYYYHO.',
           'OHYYYYYYYYYYYYYYYYYO', 'OYYYYYYYYYYYYYYYYYYO', 'OYYYYDDDDDDDDDDYYYYO', 'ODYYYYYYYYYYYYYYYYDO',
           'ODDYYYYYYYYYYYYYYDDO', '.ODDDYYYYYYYYYYDDDO.', '..OODDDDDDDDDDDDOO..', '....OOOOOOOOOOOO....']
FIDDLE = ['.....OO..........', '....OLLO..OOO....', '...OLLMLO.OLLO...', '...OLMLLOOLLMLO..', '..OOLLMOOLLLMLO..',
          '.OLLOLMOLMLLLO...', 'OLLMLOOOLLMLOO...', 'OLMLLLO.OOOOLLO..', '.OLLLMO.OD.OLMLO.', '..OOOOO.OD.OLLMLO',
          '.....OLLOD.OOLLLO', '....OLMLOD...OOO.', '....OLLMLOD......', '.....OOOOD.......', '.........D.......',
          '....OOOOOOOOO....', '...OBBBBBBBBBO...', '...OBWBWBWBWBO...', '...OWBWBWBWBWO...', '...OBWBWBWBWBO...',
          '....OWBWBWBWO....', '....OOOOOOOOO....']


def sprite_piece(rows, cm, wx, wy):
    """an upright cut-out (plant, beanbag) standing on a world point; the same picture in both cameras"""
    c = Cv()
    sx, sy = Pi(wx, wy)
    w = max(len(r) for r in rows)
    c.stamp(rows, sx - w // 2, sy - len(rows) + 1, cm)
    return c


# ---------------------------------------------------------------- pieces + spots + walk graph
def pieces():
    """(name, canvas, draw-order base (screen y of the front edge), floor box [x0, y0, x1, y1])"""
    out = []
    for i, (x, y) in enumerate(DESKS):
        out.append((f'desk{i}', desk_piece(x, y), floor_y(x + 14, y + 8), [x, y, x + 14, y + 8]))
        col = [('r3', 'r2', 'r1'), ('b3', 'b2', 'b1'), ('s4', 's3', 's2'), ('y2', 'y1', 'y0'), ('l1', 'l0', 'ink2'), ('r3', 'r2', 'r1')][i]
        out.append((f'stool{i}', chair_piece(x + 4, y + 10, col), floor_y(x + 9, y + 15), [x + 4, y + 10, x + 9, y + 15]))
    sx, sy, lx, ly, _ = SHELF
    out.append(('shelf', shelf_piece(), floor_y(sx + lx, sy + ly), [sx, sy, sx + lx, sy + ly]))
    out.append(('rig', bench_piece(), floor_y(BENCH[0] + 16, BENCH[1] + 8), [BENCH[0], BENCH[1], BENCH[0] + 16, BENCH[1] + 8]))
    out.append(('sofa', sofa_piece(), floor_y(SOFA[0] + 9, SOFA[1] + 18), [SOFA[0], SOFA[1], SOFA[0] + 9, SOFA[1] + 18]))
    out.append(('table', tea_piece(), floor_y(TEA[0] + 7, TEA[1] + 7), [TEA[0], TEA[1], TEA[0] + 7, TEA[1] + 7]))
    bx, by = BEAN[0] + 2, BEAN[1] + 2
    out.append(('beanbag', sprite_piece(BEANBAG, {'O': 'ink', 'H': 'y2', 'Y': 'y1', 'D': 'y0'}, bx, by), floor_y(bx, by) - 2,
                [BEAN[0], BEAN[1], BEAN[0] + 4, BEAN[1] + 4]))
    for i, (px, py) in enumerate(PLANTS):
        out.append((f'plant{i}', sprite_piece(FIDDLE, {'O': 'ink', 'L': 's2', 'M': 's1', 'D': 's0', 'B': 'h2', 'W': 'h3'}, px, py),
                    floor_y(px, py), [px - 2, py - 2, px + 2, py + 2]))
    return out


def blocked_boxes():
    b = [[x - 1, y - 1, x + 15, y + 9] for x, y in DESKS]
    b += [[x + 3, y + 9, x + 10, y + 16] for x, y in DESKS]      # stools and whoever sits on them
    sx, sy, lx, ly, _ = SHELF
    b += [[sx - 1, sy, sx + lx + 1, sy + ly + 1], [BENCH[0] - 1, 0, BENCH[0] + 17, BENCH[1] + 9],
          [SOFA[0], SOFA[1] - 1, SOFA[0] + 10, SOFA[1] + 19], [TEA[0] - 1, TEA[1] - 1, TEA[0] + 8, TEA[1] + 8],
          [BEAN[0] - 1, BEAN[1] - 1, BEAN[0] + 5, BEAN[1] + 5]]
    b += [[px - 3, py - 3, px + 3, py + 3] for px, py in PLANTS]
    return b


def walk_graph():
    blocked = blocked_boxes()

    def free(x, y):
        if not (2 <= x <= X - 2 and 2 <= y <= Y - 2):
            return False
        return not any(a <= x <= c and b <= y <= d for (a, b, c, d) in blocked)

    wpos, edges, spots = {}, [], {}
    G = 4
    for gx in range(2, X, G):
        for gy in range(2, Y, G):
            if free(gx, gy):
                wpos[f'g{gx}_{gy}'] = (gx, gy)
    for key, (x, y) in list(wpos.items()):
        for dx, dy in ((G, 0), (0, G), (G, G), (G, -G)):
            n = f'g{x + dx}_{y + dy}'
            if n in wpos and free(x + dx / 2, y + dy / 2):
                edges.append([key, n])

    def spot(name, wx, wy, face, z=0, sit=False, depth=None):
        sx, sy = P(wx, wy)
        spots[name] = {'x': sx, 'y': sy, 'face': face, **({'z': z, 'sit': True} if sit else {}), **({'depth': depth} if depth else {})}
        wpos[name] = (wx, wy)
        best = sorted((k for k in wpos if k.startswith('g')), key=lambda k: (wpos[k][0] - wx) ** 2 + (wpos[k][1] - wy) ** 2)[:2]
        for b in best:
            edges.append([name, b])

    for i, (x, y) in enumerate(DESKS):
        # on the stool in front of the desk, back to the viewer, facing the laptop
        spot(f'desk{i}', x + 6.5, y + 12.5, 'ur', z=5, sit=True, depth=floor_y(x + 9, y + 15) + 0.5)
    for i, (fx, fy) in enumerate(((34, 46), (44, 47), (62, 46), (70, 50), (40, 62), (66, 62))):
        spot(f'front{i}', fx, fy, 'dr')
    spot('shelf', SHELF[0] + 7, SHELF[3] + 6, 'ur')
    spot('bench', BENCH[0] + 7, BENCH[1] + 13, 'ur')
    spot('board', 34, 11, 'ul')
    spot('window', R_WIN[0] + R_WIN[1] / 2, 9, 'ur')
    sofa_depth = floor_y(SOFA[0] + 9, SOFA[1] + 18) + 1
    for i, sy in enumerate((5, 13)):
        spot(f'sofa{i}', SOFA[0] + 6, SOFA[1] + sy, 'dr', z=5, sit=True, depth=sofa_depth)
    for i, (fx, fy) in enumerate(((12, 43), (14, 64), (27, 47), (27, 63))):
        spot(f'sofa{i + 2}', fx, fy, 'dl' if fx > 20 else 'dr')
    spot('coffee', TEA[0] + 10, TEA[1] + 4, 'ul')
    spot('beanbag', BEAN[0] + 2, BEAN[1] + 2, 'dr', z=4, sit=True, depth=floor_y(BEAN[0] + 2, BEAN[1] + 2) - 1.5)
    spot('plantcorner', X - 8, 23, 'ur')
    spot('center', RUG[0], RUG[1] - 4, 'dr')
    nodes = {k: list(P(x, y)) for k, (x, y) in wpos.items()}
    return nodes, edges, spots


def steam_point():
    return list(Pi(TEA[0] + 3.5, TEA[1] + 3.5, 9))


def boxes_of(pixels):
    if not pixels:
        return None
    xs = [p[0] for p in pixels]
    ys = [p[1] for p in pixels]
    return [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]
