"""Hand-placed furniture for the top-down room: 1 art pixel = 1 px, one opaque colour per pixel.

cottage.py still owns where each piece stands (its floor box, draw order and frame position);
gen_art.py swaps the box-built picture for the one drawn here, which must have the same size.
"""
from PIL import Image

import cottage

PAL = dict(cottage.PAL, g3='#e9e6e2')

C = {k: (int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16), 255) for k, v in PAL.items()}


class Cv:
    def __init__(s, w, h):
        s.w, s.h = w, h
        s.px = {}

    def p(s, x, y, c):
        # content stays one pixel inside the frame so the outline always fits
        if 1 <= x < s.w - 1 and 1 <= y < s.h - 1:
            s.px[(x, y)] = c

    def r(s, x0, y0, x1, y1, c):
        """filled rect, inclusive"""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                s.p(x, y, c)

    def hl(s, x0, x1, y, c):
        s.r(x0, y, x1, y, c)

    def vl(s, x, y0, y1, c):
        s.r(x, y0, x, y1, c)

    def rows(s, x, y, rows, cm):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in cm:
                    s.p(x + i, y + j, cm[ch])

    def ell(s, cx, cy, rx, ry, c, only=None):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                    if only is None or only(x, y):
                        s.p(x, y, c)

    def outline(s, c):
        add = set()
        for (x, y) in s.px:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n not in s.px:
                    add.add(n)
        for (x, y) in add:
            if 0 <= x < s.w and 0 <= y < s.h:
                s.px[(x, y)] = c

    def image(s):
        im = Image.new('RGBA', (s.w, s.h), (0, 0, 0, 0))
        for (x, y), c in s.px.items():
            im.putpixel((x, y), C[c])
        return im


# ------------------------------------------------------------------ desk (30 x 31)
def plank_top(c, x0, y0, x1, y1, seams, joints):
    """wood top: planks run along x with offset butt joints and a few grain flecks"""
    c.r(x0, y0, x1, y1, 'h3')
    for sy in seams:
        c.hl(x0, x1, sy, 'h2')
    for (jx, jy0, jy1) in joints:
        c.vl(jx, jy0, jy1, 'h2')
    for (gx, gy) in [(x0 + 3, y0 + 2), (x0 + 4, y0 + 2), (x1 - 6, y0 + 7), (x1 - 5, y0 + 7), (x0 + 9, y1 - 2), (x0 + 10, y1 - 2), (x1 - 2, y0 + 3)]:
        if x0 <= gx <= x1 and y0 <= gy <= y1:
            c.p(gx, gy, 'h4' if gy % 2 else 'h2')


def desk(variant=0):
    c = Cv(30, 31)
    # legs + drawer pedestal (drawn first; the top overhangs them)
    c.r(1, 18, 4, 29, 'h2'); c.vl(1, 18, 29, 'h3'); c.vl(4, 18, 29, 'h1'); c.hl(1, 4, 29, 'h1')
    c.r(18, 18, 28, 29, 'h2'); c.vl(18, 18, 29, 'h1'); c.vl(28, 18, 29, 'h1')
    for dy in (19, 24):                       # two drawers with brass pulls and a lit lip
        c.hl(19, 27, dy, 'h3'); c.r(19, dy + 1, 27, dy + 3, 'h2'); c.hl(19, 27, dy + 4, 'h1')
        c.hl(22, 24, dy + 2, 'y0'); c.p(23, dy + 2, 'y1')
    c.hl(18, 28, 29, 'h0')
    # top
    plank_top(c, 0, 1, 29, 14, seams=[5, 10], joints=[(12, 1, 4), (21, 6, 9), (7, 11, 14)])
    c.hl(0, 29, 15, 'h4')                     # rounded front edge catches the light
    c.r(0, 16, 29, 17, 'h2'); c.hl(0, 29, 17, 'h1')
    c.hl(1, 28, 0, 'h3')
    # laptop: lid (screen at 8..17 x 2..4 is the app's overlay), keyboard, trackpad, shadow
    c.r(7, 1, 18, 5, 'g2'); c.hl(7, 18, 1, 'g3'); c.hl(7, 18, 5, 'g1')
    c.r(8, 2, 17, 4, 'n0')
    c.p(12, 1, 'g1'); c.p(13, 1, 'g1')                          # webcam notch
    c.r(7, 6, 18, 10, 'g3'); c.vl(18, 6, 10, 'g2'); c.hl(7, 18, 10, 'g2')
    for y in (6, 7, 8):
        for x in range(8, 18):
            if (x + y) % 2 == 0:
                c.p(x, y, 'g2')
    c.hl(10, 15, 8, 'g2')                                       # space bar
    c.r(11, 9, 14, 9, 'g2')                                     # trackpad
    c.hl(8, 18, 11, 'h2')                                       # soft shadow under the laptop
    # left: open notebook with ruled lines + pen
    c.r(1, 3, 5, 9, 'c3'); c.vl(3, 3, 9, 'c1')
    for y in (4, 6, 8):
        c.hl(1, 2, y, 'b2'); c.hl(4, 5, y, 'b2')
    c.vl(5, 2, 6, 'r0'); c.p(5, 7, 'g1')
    c.hl(1, 5, 10, 'h2')
    # right: mug (+ handle) and pencil cup, varied per desk
    mug = ['r1', 'b1', 's1', 'y1', 'l0', 't1'][variant % 6]
    c.r(21, 4, 23, 7, 'c2'); c.hl(21, 23, 4, 'n1'); c.hl(21, 23, 6, mug); c.p(24, 5, 'c1'); c.p(24, 6, 'c1'); c.hl(21, 24, 8, 'h2')
    c.p(22, 4, 'h0')
    if variant % 3 == 0:
        c.r(25, 2, 27, 6, 'b1'); c.hl(25, 27, 6, 'b0')         # pencil cup
        c.p(25, 1, 'y1'); c.p(25, 0, 'n0'); c.p(26, 0, 'r1'); c.p(27, 1, 's1')
    elif variant % 3 == 1:
        c.r(24, 10, 28, 11, 'r1'); c.r(24, 12, 28, 13, 'b1'); c.hl(24, 28, 11, 'r0'); c.hl(24, 28, 13, 'b0')   # book stack
        c.ell(26, 3, 1.6, 1.6, 's1'); c.p(25, 2, 's2'); c.r(25, 4, 27, 6, 't1'); c.hl(25, 27, 4, 't0')  # succulent
    else:
        c.r(24, 1, 28, 6, 'h1'); c.r(25, 2, 27, 5, 'b2'); c.p(26, 3, 'y2'); c.p(25, 5, 's2'); c.p(27, 5, 's1')  # photo frame
        c.r(22, 11, 25, 13, 'y2'); c.hl(22, 25, 13, 'y1')       # sticky note
    c.outline('h0')
    return c.image()


# ------------------------------------------------------------------ stool (12 x 17)
def stool(col):
    hi, mid, lo = col
    c = Cv(12, 17)
    c.r(2, 9, 3, 15, 'h2'); c.vl(2, 9, 15, 'h3'); c.r(8, 9, 9, 15, 'h1'); c.vl(8, 9, 15, 'h2')
    c.hl(4, 7, 12, 'h1')                                        # stretcher
    c.r(1, 5, 10, 8, mid); c.hl(1, 10, 8, lo); c.vl(10, 5, 8, lo)   # puffy cushion side
    c.r(1, 1, 10, 5, hi)                                        # cushion top
    c.hl(1, 10, 5, mid)
    c.p(1, 1, mid); c.p(10, 1, mid)
    c.p(5, 3, lo); c.p(6, 3, mid)                               # button tuft
    for (x, y) in ((3, 2), (8, 2), (3, 4), (8, 4)):
        c.p(x, y, mid)                                          # tuft creases
    c.p(2, 2, 'c3')                                             # sheen
    for x in range(2, 10, 2):
        c.p(x, 6, hi)                                           # piping stitches
    c.outline('h0')
    return c.image()


# ------------------------------------------------------------------ shelf (30 x 46)
def shelf():
    c = Cv(30, 46)
    c.r(0, 0, 29, 45, 'h2')
    c.r(0, 0, 29, 3, 'h3'); c.hl(0, 29, 0, 'h4'); c.hl(0, 29, 3, 'h2'); c.hl(0, 29, 4, 'h1')   # crown
    c.vl(0, 4, 45, 'h3'); c.vl(1, 4, 45, 'h2'); c.vl(28, 4, 45, 'h1'); c.vl(29, 4, 45, 'h2')
    bays = [(5, 14), (16, 25), (27, 36)]
    for (y0, y1) in bays:
        c.r(2, y0, 27, y1, 'h0')
        c.hl(2, 27, y0, 'ink2')                                   # shade under the shelf above
        c.hl(2, 27, y1 + 1, 'h3'); c.hl(2, 27, y1 + 2, 'h1')
    # bay 1: books + a small trailing plant
    books = [(2, 1, 8, 'r1'), (3, 2, 9, 'b1'), (5, 1, 7, 'y1'), (6, 2, 9, 's1'), (8, 1, 8, 'l0'), (9, 1, 6, 'c2')]
    def shelf_books(y1, books, x):
        for (_, w, h, col) in books:
            c.r(x, y1 - h + 1, x + w - 1, y1, col)
            c.hl(x, x + w - 1, y1 - h + 1, 'c3' if col != 'c2' else 'c1')      # page tops
            if w == 2:
                c.vl(x + 1, y1 - h + 2, y1, {'r1': 'r0', 'b1': 'b0', 'y1': 'y0', 's1': 's0', 'l0': 'ink2', 'c2': 'c0', 't1': 't0', 'r2': 'r1', 'b2': 'b1'}[col])
            c.p(x, y1 - h // 2, 'c3' if col not in ('c2', 'y1') else 'h1')      # spine band
            x += w
        return x
    x = shelf_books(14, books, 3)
    c.r(x + 1, 13, x + 3, 14, 'g2')                               # leaning book
    for i in range(6):
        c.p(x + 1 + i // 2, 13 - i, 'r2'); c.p(x + 2 + i // 2, 13 - i, 'r1')
    c.r(20, 10, 25, 14, 't1'); c.hl(20, 25, 10, 't0'); c.hl(20, 25, 11, 't1'); c.p(21, 12, 'r3')  # pot
    c.ell(22.5, 8, 3.0, 2.2, 's1'); c.p(21, 7, 's2'); c.p(23, 7, 's3'); c.p(24, 8, 's0')
    c.p(20, 11, 's1'); c.p(19, 12, 's1'); c.p(19, 13, 's2'); c.p(26, 11, 's1'); c.p(26, 12, 's2')   # trailing vines
    # bay 2: tall books, bookend, jar of buttons
    x = shelf_books(25, [(0, 2, 9, 'b1'), (0, 1, 8, 'r2'), (0, 2, 9, 'y1'), (0, 2, 7, 't1'), (0, 1, 9, 'c2'), (0, 2, 8, 's1'), (0, 1, 7, 'b2')], 3)
    c.r(x, 20, x + 1, 25, 'g1'); c.hl(x, x + 1, 20, 'g2')
    c.r(19, 19, 23, 25, 'b3'); c.hl(19, 23, 19, 'h1'); c.hl(19, 23, 20, 'c2')
    for (bx, by, bc) in [(20, 22, 'r1'), (22, 23, 'y1'), (21, 24, 's1'), (20, 24, 'l1'), (22, 21, 'b1')]:
        c.p(bx, by, bc)
    c.vl(23, 21, 25, 'b2')
    c.r(25, 22, 26, 25, 'y1'); c.p(25, 22, 'y2'); c.p(26, 21, 'y0')       # rubber duck
    # bay 3: a lying stack + a wicker basket
    for i, col in enumerate(['l1', 'r1', 'b2']):
        c.r(3, 34 - i * 2, 11 - i, 35 - i * 2, col); c.hl(3, 11 - i, 35 - i * 2, 'c3' if i else 'c2')
    c.r(14, 29, 26, 36, 'h2')
    for y in range(29, 37):
        for x in range(14, 27):
            if (x + (y // 2) * 2) % 4 == 0:
                c.p(x, y, 'h1')
    c.hl(14, 26, 29, 'h3'); c.hl(14, 26, 36, 'h1'); c.r(18, 30, 22, 31, 'c2')   # label
    # plinth with feet
    c.r(2, 39, 27, 44, 'h1'); c.hl(2, 27, 39, 'h2'); c.hl(2, 27, 44, 'h0')
    c.r(4, 40, 13, 43, 'h2'); c.r(16, 40, 25, 43, 'h2'); c.p(8, 41, 'y1'); c.p(9, 41, 'y1'); c.p(20, 41, 'y1'); c.p(21, 41, 'y1')  # drawer pulls
    c.hl(0, 29, 45, 'h0')
    c.outline('h0')
    return c.image()


# ------------------------------------------------------------------ test rig (34 x 34); overlay at (5, 12) 15 x 4
def rig():
    c = Cv(34, 34)
    c.r(1, 24, 3, 32, 'h2'); c.vl(3, 24, 32, 'h1'); c.r(30, 24, 32, 32, 'h1'); c.vl(30, 24, 32, 'h2')
    c.hl(3, 30, 29, 'h1')                                         # foot rail
    plank_top(c, 0, 6, 33, 20, seams=[11, 16], joints=[(24, 7, 10), (28, 12, 15), (9, 17, 20)])
    c.hl(0, 33, 21, 'h4'); c.r(0, 22, 33, 23, 'h2'); c.hl(0, 33, 23, 'h1')
    # the meter: mint casing with a lit top, bezel, knobs, a vent
    c.r(3, 1, 21, 4, 's3'); c.hl(3, 21, 1, 's4'); c.vl(21, 1, 4, 's2')
    c.r(3, 5, 21, 19, 's2'); c.vl(21, 5, 19, 's1'); c.hl(3, 21, 19, 's1')
    c.r(4, 11, 20, 16, 'n1')
    c.r(5, 12, 19, 15, 'n0')                                      # overlay area
    for kx in (5, 9, 13):
        c.r(kx, 7, kx + 1, 8, 'c3'); c.p(kx + 1, 8, 'g1'); c.p(kx, 7, 'n1')   # knobs
    c.hl(17, 20, 7, 's1'); c.hl(17, 20, 9, 's1')                  # vent slots
    c.p(5, 18, 'x0'); c.p(7, 18, 'y1'); c.p(9, 18, 'w1')          # jacks
    # probe cables in a loop to the right
    for (x, y, col) in [(6, 19, 'x0'), (6, 20, 'x0'), (7, 21, 'x0'), (8, 21, 'x0'), (9, 20, 'n1'), (10, 20, 'n1'), (11, 21, 'n1'), (12, 21, 'n1'),
                        (9, 19, 'n1')]:
        c.p(x, y, col)
    # flask with teal liquid + a bubble
    c.r(25, 3, 26, 6, 'b3'); c.hl(25, 26, 2, 'g2')
    c.r(24, 7, 27, 10, 'b3'); c.r(24, 9, 27, 10, 'w1'); c.p(27, 9, 'w0'); c.p(25, 9, 'b3')
    # toolbox + screwdriver + clipboard with a checklist
    c.r(24, 14, 31, 18, 'x0'); c.hl(24, 31, 14, 'r1'); c.hl(24, 31, 18, 'r0'); c.hl(26, 29, 13, 'g1'); c.p(27, 16, 'y1'); c.p(28, 16, 'y1')
    c.hl(23, 26, 12, 'y1'); c.hl(27, 29, 12, 'g2')
    c.r(29, 2, 32, 8, 'h1'); c.r(29, 3, 32, 8, 'c3'); c.hl(30, 31, 2, 'g1')
    for y in (4, 6):
        c.p(29, y, 's1'); c.hl(30, 32, y, 'g2')
    c.p(29, 8, 'x0'); c.hl(30, 31, 8, 'g2')
    c.outline('h0')
    return c.image()


# ------------------------------------------------------------------ sofa (20 x 49), along the left wall
def sofa():
    c = Cv(20, 49)
    # backrest roll along the wall
    c.r(0, 3, 5, 45, 's1'); c.vl(1, 3, 45, 's2'); c.vl(2, 3, 45, 's3'); c.vl(3, 3, 45, 's2'); c.vl(5, 3, 45, 's0')
    for y in range(8, 42, 6):
        c.p(3, y, 's1')                                          # tufting buttons on the back
    # arms (rolled, with a lit crest and a stitched panel)
    for (y0, y1) in ((0, 7), (38, 44)):
        c.r(0, y0, 18, y1, 's2'); c.hl(0, 18, y0, 's3'); c.hl(1, 17, y0 + 1, 's4'); c.hl(0, 18, y1, 's1')
        for x in range(2, 18, 2):
            c.p(x, y0 + 3, 's3')
    # seat cushions with seams, buttons and a sheen
    for (y0, y1) in ((8, 22), (23, 37)):
        c.r(6, y0, 18, y1, 's3'); c.hl(6, 18, y1, 's2'); c.vl(18, y0, y1, 's2')
        c.vl(6, y0, y1, 's2'); c.hl(7, 12, y0, 's4'); c.p(7, y0 + 1, 's4')
        c.p(12, (y0 + y1) // 2, 's1'); c.p(12, (y0 + y1) // 2 + 1, 's2')
    c.hl(6, 18, 22, 's1')
    # rose pillow leaning on the back
    c.r(6, 10, 11, 18, 'r2'); c.vl(6, 11, 17, 'r3'); c.vl(11, 11, 17, 'r1'); c.hl(7, 11, 18, 'r1')
    c.p(6, 10, 's3'); c.p(11, 10, 's3'); c.p(6, 18, 's3'); c.p(11, 18, 's3')     # puffed corners
    c.p(8, 14, 'r1'); c.p(9, 14, 'r1'); c.p(7, 12, 'r3')                         # centre crease + sheen
    # folded gingham throw on the second cushion
    for y in range(28, 35):
        for x in range(9, 18):
            c.p(x, y, 'r1' if (x // 2 + y // 2) % 2 == 0 and (x // 2) % 2 == 0 else ('r2' if (x // 2 + y // 2) % 2 == 0 else 'c3'))
    c.hl(9, 17, 34, 'r0'); c.vl(17, 28, 34, 'r2')
    for x in range(9, 18, 2):
        c.p(x, 35, 'r1')                                          # fringe
    # base front + wooden feet
    c.r(0, 45, 18, 47, 's1'); c.hl(0, 18, 45, 's2'); c.hl(0, 18, 47, 's0')
    c.r(1, 48, 2, 48, 'h1'); c.r(16, 48, 17, 48, 'h1')
    c.outline('s0')
    return c.image()


# ------------------------------------------------------------------ tea table (16 x 21)
def table():
    c = Cv(16, 21)
    c.r(2, 13, 3, 19, 'h2'); c.vl(2, 13, 19, 'h3'); c.r(12, 13, 13, 19, 'h1'); c.vl(12, 13, 19, 'h2')
    c.r(1, 1, 14, 9, 'c3')                                        # lace cloth top with a rose border
    c.hl(1, 14, 1, 'r2'); c.vl(1, 1, 9, 'r2'); c.vl(14, 1, 9, 'r2')
    c.r(1, 10, 14, 11, 'c2'); c.hl(1, 14, 10, 'r2')               # cloth drop
    for x in range(1, 15):
        if x % 3 != 1:
            c.p(x, 12, 'c1')                                      # scalloped hem
    for x in range(2, 14, 3):
        c.p(x, 11, 'c0')
    # teapot (lid, knob, spout, handle)
    c.r(5, 4, 9, 7, 'b1'); c.hl(5, 9, 4, 'b2'); c.hl(6, 8, 3, 'b2'); c.p(7, 2, 'b0')
    c.p(6, 5, 'b3'); c.hl(5, 9, 7, 'b0'); c.p(4, 5, 'b1'); c.p(3, 4, 'b1'); c.p(10, 5, 'b0'); c.p(10, 6, 'b0')
    c.hl(5, 9, 8, 'c1')                                           # its shadow on the cloth
    # two cups of tea and a cookie plate
    c.r(11, 3, 12, 4, 'c2'); c.hl(11, 12, 3, 'h1'); c.p(13, 4, 'c1'); c.hl(11, 12, 5, 'c1')
    c.r(2, 7, 3, 8, 'c2'); c.hl(2, 3, 7, 'h1'); c.p(4, 8, 'c1')
    c.r(10, 7, 13, 8, 'c1'); c.p(11, 7, 'h2'); c.p(12, 8, 'h1'); c.p(10, 8, 'h3')
    c.outline('h0')
    return c.image()


# ------------------------------------------------------------------ beanbag (20 x 12)
def beanbag():
    c = Cv(20, 12)
    c.ell(9.5, 6.2, 9.4, 5.2, 'y1')
    c.ell(9.5, 6.2, 9.4, 5.2, 'y0', only=lambda x, y: (y - 6.2) / 5.2 + (x - 9.5) / 30 > 0.45)
    c.ell(7.5, 4.6, 4.0, 2.0, 'y2')                               # the seat dent's lit rim
    c.ell(8.5, 5.2, 3.0, 1.4, 'y1')
    c.p(4, 3, 'c3'); c.p(5, 3, 'c3'); c.p(5, 2, 'y2')
    for (x, y) in [(13, 4), (14, 5), (15, 6), (3, 7), (4, 8)]:
        c.p(x, y, 'y0')                                           # fabric folds
    for x in range(6, 15, 2):
        c.p(x, 9, 'y2')                                           # seam stitches
    c.p(17, 7, 'b1'); c.p(17, 8, 'b0')                             # tag
    c.outline('h0')
    return c.image()


# ------------------------------------------------------------------ plant (17 x 22)
def plant():
    c = Cv(17, 22)
    leaves = [(4.5, 4.5, 3.4, 2.4, -1), (11.5, 3.2, 3.2, 2.4, 1), (3.5, 9.2, 3.0, 2.1, -1), (12.8, 8.6, 3.0, 2.2, 1), (8.2, 2.2, 2.2, 2.0, 0)]
    c.vl(8, 4, 15, 'h0'); c.p(7, 9, 'h0'); c.p(9, 7, 'h0')
    for (cx, cy, rx, ry, d) in leaves:
        c.ell(cx, cy, rx, ry, 's2')
        c.ell(cx, cy, rx, ry, 's1', only=lambda x, y, cx=cx, cy=cy, rx=rx, ry=ry: (y - cy) / ry > 0.25)
        c.ell(cx, cy, rx, ry, 's3', only=lambda x, y, cx=cx, cy=cy, rx=rx, ry=ry: (y - cy) / ry < -0.5 and (x - cx) / rx < 0.2)
        for t in range(-int(rx) + 1, int(rx)):
            c.p(int(cx + t), int(cy + (t * 0.25 * d)), 's0' if t > 0 else 's1')   # midrib
    # terracotta pot: lip, band, body with a sheen, saucer
    c.r(3, 14, 13, 15, 't1'); c.hl(3, 13, 14, 'r1'); c.hl(3, 13, 15, 't0')
    c.r(4, 16, 12, 20, 't1'); c.vl(11, 16, 20, 't0'); c.vl(12, 16, 20, 't0'); c.vl(5, 17, 19, 'r1')
    c.hl(6, 10, 18, 'c2'); c.p(7, 18, 's1'); c.p(9, 18, 'r1')        # painted band
    c.r(2, 21, 14, 21, 't0')
    c.outline('s0')
    return c.image()


STOOL_COLS = [('r3', 'r2', 'r1'), ('b3', 'b2', 'b1'), ('s4', 's3', 's2'), ('y2', 'y1', 'y0'), ('l1', 'l0', 'ink2'), ('r3', 'r2', 'r1')]


def drawn(name):
    """the hand-drawn picture for a cottage piece name, or None to keep the box-built one"""
    if name.startswith('desk'):
        return desk(int(name[4:]))
    if name.startswith('stool'):
        return stool(STOOL_COLS[int(name[5:])])
    if name.startswith('plant'):
        return plant()
    make = {'shelf': shelf, 'rig': rig, 'sofa': sofa, 'table': table, 'beanbag': beanbag}.get(name)
    return make() if make else None
