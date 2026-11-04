"""Built-in critters: original chibi creatures, 1 art pixel = 1 px, one colour per pixel.

Every critter is built from simple shapes (ellipses, triangles) rasterised on pixel
centres, so silhouettes are round and exactly symmetric. Each shape gets a 3-tone
ramp lit from the top, a coloured (selective) outline in its own darkest tone, and
the face is stamped on afterwards. Output per critter is a 6-frame strip the app
slices: front, walk front x2, back, walk back x2.
Run `python3 gen_critters.py` (writes app/public/assets/critters).
"""
import json
import os
from PIL import Image

W, H = 25, 27  # odd width: column 12 is the axis of symmetry


def hexc(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def ellipse(cx, cy, rx, ry):
    return lambda x, y: ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0


def tri(a, b, c):
    def f(x, y):
        px, py = x + 0.5, y + 0.5
        d = lambda p, q: (px - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (py - q[1])
        s1, s2, s3 = d(a, b), d(b, c), d(c, a)
        return not ((s1 < 0 or s2 < 0 or s3 < 0) and (s1 > 0 or s2 > 0 or s3 > 0))
    return f


def mirror(f):
    """shape plus its mirror image across the centre column"""
    return lambda x, y: f(x, y) or f(W - 1 - x, y)


def union(*fs):
    return lambda x, y: any(f(x, y) for f in fs)


def minus(f, g):
    return lambda x, y: f(x, y) and not g(x, y)


class Canvas:
    def __init__(self):
        self.px = [[None] * W for _ in range(H)]   # colour
        self.part = [[None] * W for _ in range(H)]  # owning layer id

    def layer(self, mask, ramp, lid, shade_top=None, shade_bot=None):
        """fill mask with ramp=(light, base, dark, line). Light on the top rim, dark on the bottom rim."""
        cells = {(x, y) for y in range(H) for x in range(W) if mask(x, y)}
        for (x, y) in cells:
            c = ramp[1]
            if (x, y + 1) not in cells or (shade_bot and y >= shade_bot):
                c = ramp[2]
            elif (x, y - 1) not in cells or (x, y - 2) not in cells and shade_top is not False:
                c = ramp[0]
            self.px[y][x] = c
            self.part[y][x] = lid
        # internal edge where this layer sits on another one: line in this layer's darkest tone
        for (x, y) in cells:
            for dx, dy in ((0, 1), (1, 0), (-1, 0)):
                n = (x + dx, y + dy)
                if n not in cells and 0 <= n[0] < W and 0 <= n[1] < H and self.part[n[1]][n[0]] not in (None, lid):
                    if dy == 1:
                        self.px[y][x] = ramp[3]
        return cells

    def paint(self, mask, c, on=None):
        for y in range(H):
            for x in range(W):
                if mask(x, y) and self.px[y][x] is not None and (on is None or self.part[y][x] == on):
                    self.px[y][x] = c

    def put(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = c

    def outline(self, line_of):
        """selective outline: each empty cell touching the sprite takes the line colour of its neighbour"""
        add = {}
        for y in range(H):
            for x in range(W):
                if self.px[y][x] is not None:
                    continue
                for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and self.px[ny][nx] is not None:
                        add[(x, y)] = line_of(self.part[ny][nx])
                        break
        for (x, y), c in add.items():
            self.px[y][x] = c

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for y in range(H):
            for x in range(W):
                if self.px[y][x] is not None:
                    im.putpixel((x, y), self.px[y][x])
        return im


def ramp(light, base, dark, line):
    return tuple(hexc(c) for c in (light, base, dark, line))


# flat "sticker" style: solid black outline, one flat fill, one darker tone for the
# bottom edge / stripes / feet, tiny wide-set dot eyes, a little 'ㅅ' mouth and pink cheeks
INK = hexc('#2a2230')
BLUSH = hexc('#ff9db0')
PINK = hexc('#ffb6c6')


def rrect(x0, y0, x1, y1, r):
    """rounded rectangle on pixel centres, inclusive bounds"""
    def f(x, y):
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.5
    return f


def flat(cv, mask, rp, lid):
    """flat fill: base colour, darker tone along the bottom and the right (shadow) edge"""
    cells = {(x, y) for y in range(H) for x in range(W) if mask(x, y)}
    for (x, y) in cells:
        edge = (x, y + 1) not in cells or ((x + 1, y) not in cells and (x, y - 2) in cells)
        cv.px[y][x] = rp[2] if edge else rp[1]
        cv.part[y][x] = lid
    return cells


def face(cv, y, cx=14, gap=4, mouth=True):
    """dot eyes (1x2), 'ㅅ' mouth between them one row lower, cheeks just outside the eyes"""
    for x in (cx - gap, cx + gap):
        cv.put(x, y, INK); cv.put(x, y + 1, INK)
    if mouth:
        cv.put(cx, y + 1, INK); cv.put(cx - 1, y + 2, INK); cv.put(cx + 1, y + 2, INK)
    for x in (cx - gap - 2, cx - gap - 1, cx + gap + 1, cx + gap + 2):
        cv.put(x, y + 2, BLUSH)


def stubs(cv, rp, lift, y=24, xs=(6, 10, 15, 19)):
    """four little legs under the loaf; walking lifts one pair"""
    for i, x in enumerate(xs):
        up = 1 if (lift == 'L' and i in (0, 2)) or (lift == 'R' and i in (1, 3)) else 0
        for yy in range(y, y + 2 - up):
            cv.px[yy][x] = rp[2]; cv.part[yy][x] = 'legs'
            cv.px[yy][x + 1] = rp[2]; cv.part[yy][x + 1] = 'legs'


def ears_tri(cv, rp, left, right, lid='ears'):
    m = union(tri(*left), tri(*right))
    return flat(cv, m, rp, lid)


def stripes(cv, rp, pts):
    for (x, y) in pts:
        if cv.px[y][x] is not None and cv.part[y][x] == 'body':
            cv.px[y][x] = rp[2]


# main fur/feather ramp per critter (light, base, dark, line); the app can recolour exactly these
MAIN_HEX = {
    'shiba': ('#ffc27a', '#f6a04d', '#d97a2a', '#a85a1c'),
    'cat': ('#c3c5cf', '#a7a9b4', '#7f8290', '#5d606c'),
    'penguin': ('#7fb0ec', '#4f86d6', '#3563ad', '#24477e'),
    'hamster': ('#ffdcaa', '#f7bd74', '#dc9a52', '#a8702e'),
    'rabbit': ('#ffffff', '#f6f1f4', '#ddd2da', '#b8a8b6'),
    'frog': ('#a9e27c', '#80c75c', '#5e9e42', '#3f7a2c'),
    'chick': ('#fff3a8', '#ffdc5c', '#f0b830', '#c48a14'),
}
MAIN = {k: ramp(*v) for k, v in MAIN_HEX.items()}
WHITE = ramp('#ffffff', '#fffaf4', '#e8ddd2', '#c8b8a8')

# the loaf every critter is built on: a soft rounded block, a little wider than tall
LOAF = rrect(3, 9, 22, 24, 6)


def finish(cv):
    cv.outline(lambda lid: INK)
    return cv.image()


# ---------------------------------------------------------------- species (faces turned a little to the right)
def cat(view, lift):
    G = MAIN['cat']
    cv = Canvas()
    stubs(cv, G, lift)
    # tail curling up on the left (behind)
    flat(cv, union(rrect(1, 6, 2, 20, 1), rrect(1, 5, 4, 6, 1)), G, 'tail')       # tail standing up, tip curled
    ears_tri(cv, G, ((5, 9.5), (6.5, 3.5), (11, 8.5)), ((16, 8.5), (20.5, 3.5), (21.5, 9.5)))
    flat(cv, LOAF, G, 'body')
    for (x, y) in [(1, 9), (2, 9), (1, 12), (2, 12)]:
        cv.px[y][x] = G[2]                                                # tail rings
    for y in range(H):                                                    # line where the tail meets the body
        if cv.part[y][2] == 'tail' and cv.part[y][3] == 'body':
            cv.px[y][3] = INK
    # tabby marks: three on the forehead, a few on the flank
    stripes(cv, G, [(13, 9), (13, 10), (11, 9), (15, 9)])
    if view == 'front':
        stripes(cv, G, [(4, 15), (5, 15), (4, 18), (5, 18), (21, 15), (21, 18)])
        face(cv, 13)
    else:
        stripes(cv, G, [(x, y) for y in (13, 16, 19) for x in range(9, 17)])
    return finish(cv)


def shiba(view, lift):
    O = MAIN['shiba']
    cv = Canvas()
    stubs(cv, O, lift)
    if view == 'back':
        flat(cv, rrect(1, 11, 5, 16, 2), O, 'tail')                          # curled tail
    ears_tri(cv, O, ((5, 9.5), (6, 3.5), (11, 8.5)), ((16, 8.5), (21, 3.5), (21.5, 9.5)))
    flat(cv, LOAF, O, 'body')
    if view == 'front':
        # cream lower face and chest
        for y in range(15, 24):
            for x in range(8, 21):
                if LOAF(x, y) and ((x - 14) ** 2 / 20 + (y - 20) ** 2 / 12 <= 1):
                    cv.px[y][x] = WHITE[1]
        cv.put(9, 11, WHITE[1]); cv.put(19, 11, WHITE[1])                     # brow dots
        face(cv, 13)
        for (x, y) in [(7, 5), (19, 5)]:
            cv.put(x, y, PINK)
    else:
        for y in range(11, 16):
            for x in range(1, 5):
                if rrect(2, 12, 4, 15, 1)(x, y):
                    cv.px[y][x] = WHITE[1]
    return finish(cv)


def penguin(view, lift):
    B = MAIN['penguin']
    Y = ramp('#ffe07a', '#ffc23d', '#e09a1c', '#a8700e')
    cv = Canvas()
    stubs(cv, Y, lift, xs=(8, 16))
    flat(cv, union(rrect(1, 14, 4, 20, 2), rrect(20, 14, 23, 20, 2)), B, 'wing')   # flippers
    flat(cv, rrect(4, 5, 21, 24, 7), B, 'body')
    cv.put(12, 4, INK); cv.put(13, 3, INK)                                   # tuft (outline colour)
    if view == 'front':
        for y in range(8, 24):
            for x in range(6, 21):
                if (x - 14) ** 2 / 42 + (y - 16) ** 2 / 64 <= 1:
                    cv.px[y][x] = WHITE[1]
        face(cv, 12, mouth=False)
        cv.put(13, 14, Y[1]); cv.put(14, 14, Y[1]); cv.put(15, 14, Y[1]); cv.put(14, 15, Y[2])   # beak
    return finish(cv)


def hamster(view, lift):
    O = MAIN['hamster']
    cv = Canvas()
    stubs(cv, ramp('#ffd0d8', '#ffb6c3', '#e48da0', '#9a4a5a'), lift, xs=(7, 17))
    flat(cv, union(rrect(4, 6, 8, 10, 2), rrect(17, 6, 21, 10, 2)), O, 'ears')
    flat(cv, rrect(2, 8, 23, 24, 8), O, 'body')
    if view == 'front':
        for (x, y) in [(5, 7), (6, 7), (18, 7), (19, 7)]:
            cv.put(x, y, PINK)
        for y in range(16, 24):
            for x in range(5, 23):
                if (x - 14) ** 2 / 60 + (y - 21) ** 2 / 16 <= 1:
                    cv.px[y][x] = WHITE[1]
        face(cv, 13)
    return finish(cv)


def rabbit(view, lift):
    R = MAIN['rabbit']
    cv = Canvas()
    stubs(cv, R, lift)
    flat(cv, union(rrect(7, 0, 10, 10, 2), rrect(16, 0, 19, 10, 2)), R, 'ears')
    flat(cv, LOAF, R, 'body')
    if view == 'front':
        for y in range(2, 8):
            cv.put(8, y, PINK); cv.put(9, y, PINK); cv.put(17, y, PINK); cv.put(18, y, PINK)
        face(cv, 14)
    else:
        flat(cv, rrect(12, 19, 15, 22, 1), WHITE, 'tail')
    return finish(cv)


def frog(view, lift):
    F = MAIN['frog']
    cv = Canvas()
    stubs(cv, F, lift)
    flat(cv, union(rrect(4, 5, 10, 11, 3), rrect(17, 5, 23, 11, 3)), F, 'bumps')    # eye bumps
    flat(cv, rrect(3, 9, 23, 24, 6), F, 'body')
    if view == 'front':
        for y in range(17, 24):
            for x in range(7, 21):
                if (x - 14) ** 2 / 40 + (y - 21) ** 2 / 10 <= 1:
                    cv.px[y][x] = hexc('#fff2c8')
        for x in (7, 20):
            cv.put(x, 7, INK); cv.put(x, 8, INK)                              # eyes in the bumps
        for x in range(11, 18):
            cv.put(x, 13 if x in (11, 17) else 14, INK)                       # wide smile
        for x in (5, 6, 21, 22):
            cv.put(x, 13, BLUSH)
    return finish(cv)


def chick(view, lift):
    Y = MAIN['chick']
    O = ramp('#ffc07a', '#ff9f43', '#e07a22', '#a8580e')
    cv = Canvas()
    stubs(cv, O, lift, xs=(8, 16))
    flat(cv, union(rrect(1, 14, 3, 19, 1), rrect(21, 14, 23, 19, 1)), Y, 'wing')
    flat(cv, rrect(3, 6, 22, 24, 9), Y, 'body')
    cv.put(13, 5, INK); cv.put(14, 4, INK); cv.put(12, 4, INK)              # tuft
    if view == 'front':
        face(cv, 13, mouth=False)
        cv.put(13, 15, O[1]); cv.put(14, 15, O[1]); cv.put(15, 15, O[1]); cv.put(14, 16, O[2])   # beak
    return finish(cv)


CRITTERS = {'shiba': shiba, 'cat': cat, 'penguin': penguin, 'hamster': hamster, 'rabbit': rabbit, 'frog': frog, 'chick': chick}
FRAMES = [('front', None), ('front', 'L'), ('front', 'R'), ('back', None), ('back', 'L'), ('back', 'R')]

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'public', 'assets', 'critters')


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    for name, make in CRITTERS.items():
        strip = Image.new('RGBA', (W * len(FRAMES), H), (0, 0, 0, 0))
        for i, (view, lift) in enumerate(FRAMES):
            strip.alpha_composite(make(view, lift), (i * W, 0))
        strip.save(os.path.join(OUT, f'{name}.png'))
    with open(os.path.join(OUT, 'critters.json'), 'w') as f:
        json.dump({k: list(v) for k, v in MAIN_HEX.items()}, f)
    print('critters written:', ', '.join(CRITTERS))


if __name__ == '__main__':
    main()
