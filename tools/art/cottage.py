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
    'wd': '#5e3c30', 'h0': '#86583c', 'h1': '#b27a4f', 'h2': '#d29d67', 'h3': '#e7be88', 'h4': '#f4dbab',   # wood outline + honey wood
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


# Wall fixtures are drawn as pixel grids: on a wall, half a unit along it and one unit up is
# exactly one pixel in both cameras, so a grid cell maps 1:1 onto the screen (iso just shears it).
def grid_at(grid, u, z, u0, ztop):
    """the grid's cell under wall point (u, z); grid rows run top-down from height ztop"""
    i, j = math.floor((u - u0) * 2), math.floor(ztop - z)
    if 0 <= j < len(grid) and 0 <= i < len(grid[j]):
        return grid[j][i]
    return None


def window_grid(w, h):
    """wooden casement with a cross mullion, streaked glass and a gathered lace curtain on the left"""
    g = [['h2'] * w for _ in range(h)]
    for j in range(h):
        for i in range(w):
            if i == 0 or j == 0 or i == w - 1 or j == h - 1:
                g[j][i] = 'h0'
            elif j == 1 or i == 1:
                g[j][i] = 'h3'
            elif j == h - 2 or i == w - 2:
                g[j][i] = 'h1'
    x0, x1, y0, y1 = 3, w - 3, 5, h - 3            # glass area (header beam above it)
    for i in range(2, w - 2):
        g[2][i], g[3][i], g[4][i] = 'h2', 'h1', 'h0'
    mx, my = w // 2 - 1, y0 + (y1 - y0) // 2 - 1
    for j in range(y0, y1):
        for i in range(x0, x1):
            if i in (x0, x1 - 1) or j == y1 - 1:
                g[j][i] = 'h0'
            elif i in (mx, mx + 1):
                g[j][i] = 'h2' if i == mx else 'h1'
            elif j in (my, my + 1):
                g[j][i] = 'h3' if j == my else 'h1'
            elif j == y0:
                g[j][i] = 'h0'
            else:
                g[j][i] = GLASS
    # two short diagonal glints per pane
    for pi, pj in ((x0 + 2, y0 + 2), (mx + 3, y0 + 2), (x0 + 2, my + 3), (mx + 3, my + 3)):
        for d in range(4):
            for t in (0, 1):
                i, j = pi + 3 - d + t, pj + d
                if g[j][i] is GLASS:
                    g[j][i] = 'b3'
    # curtain: straight under the rod, tied back at the middle, flaring to a lace hem
    tie = y0 + (y1 - y0) // 2 + 2
    for j in range(2, h - 1):
        if j < tie:
            wd = 9 - max(0, (j - 8)) * 5 // max(1, tie - 8)
        else:
            wd = 4 + (j - tie) * 5 // max(1, h - 2 - tie)
        for i in range(1, 1 + wd):
            edge = i == wd
            if edge:
                col = 'c0'
            elif j == tie or j == tie - 1:
                col = 'r1' if j == tie else 'r2'
            elif (i + (1 if j > tie else 0)) % 3 == 0:
                col = 'c1'
            else:
                col = 'c3'
            g[j][i] = col
        if j == h - 2:
            for i in range(1, 1 + wd):
                g[j][i] = 'c1' if i % 2 else 'c3'
    for i in range(0, w):                           # curtain rod
        g[1][i] = 'h0' if i in (0, w - 1) else ('y0' if i % 7 == 0 else 'h0')
    return g


def door_grid(w, h):
    """wooden plank door in a frame: plank seams, a cross brace, nail dots and a brass knob"""
    g = [['h2'] * w for _ in range(h)]
    for j in range(h):
        for i in range(w):
            if i == 0 or i == w - 1 or j == 0:
                g[j][i] = 'h0'
            elif i in (1, w - 2) or j == 1:
                g[j][i] = 'h3' if (i == 1 or j == 1) else 'h1'
            elif i == 2 or i == w - 3 or j == 2:
                g[j][i] = 'h0'
            else:
                k_ = (i - 3) % 4
                g[j][i] = 'h1' if k_ == 3 else ('h3' if k_ == 0 else 'h2')
    for bj in (6, h - 7):                           # cross braces
        for i in range(3, w - 3):
            g[bj][i] = 'h0'
            g[bj + 1][i] = 'h3'
            g[bj + 2][i] = 'h2'
            g[bj + 3][i] = 'h0'
        for i in range(4, w - 4, 4):
            g[bj + 2][i] = 'h0'                     # nails
    kx, ky = w - 6, h // 2
    for (i, j), col in {(0, 0): 'h0', (1, 0): 'h0', (-1, 1): 'h0', (0, 1): 'y2', (1, 1): 'y1', (2, 1): 'h0',
                        (-1, 2): 'h0', (0, 2): 'y1', (1, 2): 'y0', (2, 2): 'h0', (0, 3): 'h0', (1, 3): 'h0'}.items():
        g[ky + j][kx + i] = col
    return g


WIN_GRID = window_grid(R_WIN[1] * 2, R_WIN[3])
DOOR_GRID = door_grid(R_DOOR[1] * 2, R_DOOR[2])


def window_col(u, z, u0, w, z0, h):
    return grid_at(WIN_GRID, u, z, u0, z0 + h)


def door_col(u, z, u0, w, h):
    return grid_at(DOOR_GRID, u, z, u0, h)


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


def cloth(c, x0, y0, x1, y1, fill, rim, band):
    """a flat cloth on the floor: rasterised first, then its rings are counted in screen pixels so the
    stitched rim and the border band stay exactly 1 px wide in both cameras"""
    cells = {}

    class Rec:
        def px(self, sx, sy, v):
            cells[(sx, sy)] = v
    face_top(Rec(), x0, y0, x1, y1, 0, lambda x, y: (x, y))
    ring, edge = {}, [p for p in cells if any((p[0] + dx, p[1] + dy) not in cells
                                              for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for p in edge:
        ring[p] = 0
    d = 0
    while edge:
        d += 1
        nxt = []
        for (sx, sy) in edge:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (sx + dx, sy + dy)
                if q in cells and q not in ring:
                    ring[q] = d
                    nxt.append(q)
        edge = nxt
    for (sx, sy), (x, y) in cells.items():
        r = ring[(sx, sy)]
        if r == 0:
            col = rim(sx, sy)
        elif r <= len(band):
            col = band[r - 1](sx, sy) if callable(band[r - 1]) else band[r - 1]
        else:
            col = fill(x, y)
        c.px(sx, sy, col)


def rug(c):
    """picnic-blanket gingham in rose and cream, with a stitched rim like the reference blankets"""
    cx, cy, rx, ry = RUG

    def gingham(x, y):
        a, b = math.floor(x / 2) % 2, math.floor(y / 2) % 2
        return 'r1' if a and b else ('r2' if a or b else 'c3')
    cloth(c, cx - rx, cy - ry, cx + rx, cy + ry, gingham,
          lambda sx, sy: 'ink2' if (sx + sy) % 2 else 'c3', ['c3', lambda sx, sy: 'r1' if (sx + sy) % 4 == 0 else 'c3'])


def doormat(c):
    x0, x1 = R_DOOR[0], R_DOOR[0] + R_DOOR[1]
    cloth(c, x0, 1, x1, 6, lambda x, y: 's2' if math.floor(x) % 2 else 's1',
          k('s0'), ['s3'])


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
    box(c, R_WIN[0] - 1, 0, R_WIN[2] - 1, R_WIN[1] + 2, 2, 1, 'h3', 'h2', 'h1')
    if MODE == 'iso':
        box(c, 0, L_WIN[0] - 1, L_WIN[2] - 1, 2, L_WIN[1] + 2, 1, 'h3', 'h2', 'h1')
    bx, by = Pi(R_DOOR[0] + R_DOOR[1] / 2, 0, R_DOOR[2] + 4)
    c.stamp(['..O..', '.OYO.', '.OYO.', 'OYHYO', 'OOOOO', '..O..'], bx - 2, by - 3, {'O': 'ink', 'Y': 'y1', 'H': 'y2'})
    # floor things
    rug(c)
    doormat(c)
    # outline the room's silhouette (glass is interior, so it stays clear)
    c.outline()
    for key in glass:
        for (sx, sy) in glass[key]:
            c.p[sx, sy] = (0, 0, 0, 0)
    return c, glass


# ---------------------------------------------------------------- furniture
# Furniture follows the reference pieces: dark cocoa outline, lit top edge, plank seams and nail
# dots on wood, seams and buttons on cloth. Bands are 1 unit (or half a unit across a wall-facing
# face) so every line lands on whole pixels in both cameras.
def plank_top(y0, ly, light='h3', seam='h2', edge='h4'):
    """a wooden top with planks running along x; the front-most row catches the light"""
    def f(a, b):
        r = b - y0
        if r >= ly - 1:
            return edge
        return seam if r % 3 >= 2.5 else light
    return f


def wood_front(z0, z1, base='h2', lit='h3', dark='h1'):
    """a wooden front: lit top row, shaded bottom row"""
    def f(u, z):
        if z >= z1 - 1:
            return lit
        if z < z0 + 1:
            return dark
        return base
    return f


def desk_piece(x, y):
    c = Cv()
    box(c, x, y, 0, 1, 8, 9, 'h2', wood_front(0, 9, 'h2', 'h2', 'h1'), 'h1')
    box(c, x + 13, y, 0, 1, 8, 9, 'h2', wood_front(0, 9, 'h2', 'h2', 'h1'), 'h1')

    def drawers(u, z):
        if z >= 8:
            return 'h3'
        if z < 1 or 4 <= z < 5:
            return 'h0'
        if abs(u - (x + 11)) < .5 and (z // 1) in (2, 6):
            return 'y1'
        if u < x + 9.5 or u >= x + 12.5:
            return 'h1'
        return 'h2'
    box(c, x + 9, y, 0, 4, 8, 9, 'h3', drawers, 'h1')
    box(c, x, y, 9, 14, 8, 2, plank_top(y, 8),
        lambda u, z: 'h3' if z >= 10 else ('wd' if (u - x) % 4 < .5 and u > x + 1 else 'h2'), 'h1')
    box(c, x + 3, y + 2, 11, 6, 4, 1, 'g2', 'g1', 'g1')          # laptop base
    face_front(c, x + 3, x + 9, y + 2, 12, 17,
               lambda u, z: 'g2' if (u < x + 3.5 or u >= x + 8.5 or z < 12.6 or z >= 16.5) else 'n0')
    box(c, x + 11, y + 4, 11, 2, 2, 2, 'c3', lambda u, z: 'r1' if 12 <= z < 13 else 'c2', 'c1')   # mug
    return c.outline('wd')


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
    hi, mid, lo = col
    c = Cv()
    for lx, ly in ((0, 0), (4, 0), (0, 4), (4, 4)):
        box(c, x + lx, y + ly, 0, 1, 1, 3, 'h2', 'h2', 'h1')
    box(c, x, y, 3, 5, 5, 2, lambda a, b: lo if (math.floor(a) == x + 2 and math.floor(b) == y + 2) else
        (mid if (a < x + 1 or b < y + 1 or a >= x + 4 or b >= y + 4) else hi),
        lambda u, z: mid if z >= 4 else lo, lo)
    return c.outline('wd')


def shelf_piece():
    c = Cv()
    x0, y0, lx, ly, lz = SHELF
    rnd = random.Random(4)
    cols = ['r1', 's1', 'b1', 'y1', 'l0', 't1', 'c2', 's2', 'r2', 'b0']
    book = {}

    def front(u, z):
        if z >= lz - 1:
            return 'h3'
        if u < x0 + .5 or u >= x0 + lx - .5 or z < 1:
            return 'h1'
        if u < x0 + 1 or u >= x0 + lx - 1:
            return 'h2'
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
    box(c, x0, y0, 0, lx, ly, lz, plank_top(y0, ly), front,
        lambda v, z: 'h2' if z >= lz - 1 else ('h0' if (z - 1) % 7.5 < 1 and z > 2 else 'h1'))
    return c.outline('wd')


RIG_STATES = ['rig_idle', 'rig_run0', 'rig_run1', 'rig_run2', 'rig_pass', 'rig_fail']


def bench_piece():
    x, y = BENCH
    c = Cv()
    for lx, ly in ((0, 0), (15, 0), (0, 7), (15, 7)):
        box(c, x + lx, y + ly, 0, 1, 1, 9, 'h2', 'h2', 'h1')
    box(c, x, y, 3, 16, 8, 1, plank_top(y, 8), 'h2', 'h1')
    box(c, x + 2, y + 2, 4, 5, 4, 2, lambda a, b: 'b3' if b < y + 3 else 'b2', lambda u, z: 'c3' if 5 <= z < 6 and u < x + 6 else 'b1', 'b0')
    box(c, x, y, 9, 16, 8, 2, plank_top(y, 8),
        lambda u, z: 'h3' if z >= 10 else ('wd' if (u - x) % 4 < .5 and u > x + 1 else 'h2'), 'h1')
    box(c, x + 1, y + 1, 11, 9, 5, 7, 's3', 's2', 's1')          # mint test meter
    face_front(c, x + 2, x + 9.5, y + 6, 13, 17, k('n0'))
    box(c, x + 12, y + 3, 11, 1, 1, 3, 'w1', 'w1', 'w0')         # flask
    return c.outline('wd')


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
    """sage sofa: piped arms and back, two tufted seat cushions, a rose pillow and a folded gingham throw"""
    x, y = SOFA
    c = Cv()

    def base_front(u, z):
        return 's0' if z < 1 else 's1'
    box(c, x, y, 0, 9, 18, 4, 's1', base_front, lambda v, z: 's0' if z < 1 else 's1')
    box(c, x, y, 4, 3, 18, 7, lambda a, b: 's3' if a >= x + 2 else 's2',
        lambda u, z: 's2' if z >= 10 else 's1', lambda v, z: 's2' if z >= 10 else 's1')
    for ay in (y, y + 15):
        box(c, x + 3, ay, 4, 6, 3, 4, lambda a, b: 's3' if (b >= ay + 2) else 's2',
            lambda u, z: 's2' if z >= 7 else ('s0' if z < 5 else 's1'), lambda v, z: 's2' if z >= 7 else 's1')

    def cushion(y0):
        def top(a, b):
            if b >= y0 + 5:
                return 's4'
            if (math.floor(a), math.floor(b)) in ((x + 5, y0 + 2), (x + 5, y0 + 3)):
                return 's1'
            return 's3'
        return top
    box(c, x + 3, y + 3, 4, 6, 6, 1, cushion(y + 3), 's2', 's2')
    box(c, x + 3, y + 9, 4, 6, 6, 1, cushion(y + 9), 's2', 's2')
    box(c, x + 3, y + 4, 5, 2, 3, 3, lambda a, b: 'r3' if b < y + 6 else 'r2',
        lambda u, z: 'r2' if z >= 7 else 'r1', 'r1')                                     # pillow
    box(c, x + 3, y + 11, 5, 6, 3, 1,
        lambda a, b: 'r1' if (math.floor(a) % 2 and math.floor(b) % 2) else ('r2' if (math.floor(a) + math.floor(b)) % 2 else 'c3'),
        lambda u, z: 'c3' if (u * 2) % 2 < 1 else 'r2', 'r2')                           # folded throw
    return c.outline('wd')


def tea_piece():
    """tea table under a lace cloth with a scalloped hem, a teapot and a cup"""
    x, y = TEA
    c = Cv()
    for lx, ly in ((0, 0), (6, 0), (0, 6), (6, 6)):
        box(c, x + lx, y + ly, 0, 1, 1, 4, 'h2', 'h2', 'h1')

    def cloth_top(a, b):
        return 'r2' if min(a - x, b - y, x + 7 - a, y + 7 - b) < .5 else 'c3'

    def hem(u, z):
        if z < 3.5:
            return 'c1' if (u * 2) % 2 < 1 else None
        return 'c2'

    def hem_side(v, z):
        if z < 3.5:
            return 'c0' if (v * 2) % 2 < 1 else None
        return 'c1'
    box(c, x, y, 3, 7, 7, 2, cloth_top, hem, hem_side)
    box(c, x + 2, y + 2, 5, 3, 3, 3, lambda a, b: 'c3' if b < y + 4 else 'c2',
        lambda u, z: 'b1' if 6 <= z < 7 else 'c2', 'c1')                                # teapot
    face_top(c, x + 3, y + 3, x + 4, y + 4, 8, k('b1'))                                 # lid knob
    box(c, x + 5, y + 1, 5, 1, 1, 1, 'c3', 'r1', 'r0')                                   # cup
    return c.outline('wd')


BEANBAG = ['.....OOOOOOOOOO.....', '...OOHHHHHHHHYYOO...', '..OHHHWWHHYYYYYYYO..', '.OHHWWHYYYYYYYYYYYO.',
           'OHHHHYYYYYYYYYYYYYDO', 'OHYYYYYYYYYYYYYYYYDO', 'OYYYYYYYYYYYYYYYYDDO', 'OYYYDYYYYYYYYYYYYDDO',
           'ODYYYDDYYYYYYYYYDDDO', '.ODDYYYDDDDDDDDDDDO.', '..OODDDDDDDDDDDDOO..', '....OOOOOOOOOOOO....']
FIDDLE = ['.....OO..........', '....OLLO..OOO....', '...OLLMLO.OLLO...', '...OLMLLOOLLMLO..', '..OOLLMOOLLLMLO..',
          '.OLLOLMOLMLLLO...', 'OLLMLOOOLLMLOO...', 'OLMLLLO.OOOOLLO..', '.OLLLMO.OD.OLMLO.', '..OOOOO.OD.OLLMLO',
          '.....OLLOD.OOLLLO', '....OLMLOD...OOO.', '....OLLMLOD......', '.....OOOOD.......', '.........D.......',
          '....OOOOOOOOO....', '...OBBBBBBBBBO...', '...OBWBWBWBWBO...', '...OWBWBWBWBWO...', '...OBWBWBWBWBO...',
          '....OWBWBWBWO....', '....OOOOOOOOO....']
FIDDLE = FIDDLE[:15] + [r.replace('O', 'P') for r in FIDDLE[15:]]   # leaves outlined in deep green, the pot in cocoa


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
    out.append(('beanbag', sprite_piece(BEANBAG, {'O': 'wd', 'H': 'y2', 'W': 'c3', 'Y': 'y1', 'D': 'y0'}, bx, by), floor_y(bx, by) - 2,
                [BEAN[0], BEAN[1], BEAN[0] + 4, BEAN[1] + 4]))
    for i, (px, py) in enumerate(PLANTS):
        out.append((f'plant{i}', sprite_piece(FIDDLE, {'O': 'g0', 'P': 'wd', 'L': 's2', 'M': 's1', 'D': 'h0', 'B': 'h2', 'W': 'h3'}, px, py),
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
