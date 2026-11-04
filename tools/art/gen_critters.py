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


EYE = hexc('#1e1420')
SHINE = hexc('#ffffff')
BLUSH = hexc('#ff8fa6')
MOUTH = hexc('#4a1e28')
TONGUE = hexc('#ff6f86')


EYE_MID = hexc('#7a5368')


EYE_ROWS = ['WE', 'EE', 'EE', 'GE']


def face(cv, y, cx=13, nose=None, mouth_=True, blush_dy=4):
    """clear, front-facing face (reads at a glance, like a handheld-game follower sprite):
    two round 3x5 eyes with a shine, optional nose, small open smile, pink cheeks"""
    for x0 in (cx - 5, cx + 4):
        for dy, row in enumerate(EYE_ROWS):
            for dx, ch in enumerate(row):
                if ch != '.':
                    cv.put(x0 + dx, y + dy, {'E': EYE, 'W': SHINE, 'G': EYE_MID}[ch])
    if nose is not None:
        cv.put(cx, y + 4, nose)
    if mouth_:
        mouth(cv, cx - 1, y + 5)
    by = y + blush_dy
    for x in (cx - 8, cx - 7, cx + 7, cx + 8):
        cv.put(x, by, BLUSH)


def feet(cv, rp, lid, lift=None, y=24):
    """far foot (left, a touch higher) and near foot (right)"""
    for side, x, yy in (('L', 9.0, y - 0.4), ('R', 15.5, y)):
        dy = -1 if lift == side else 0
        cv.layer(ellipse(x, yy + 0.6 + dy, 2.6, 1.7), rp, lid)


def mouth(cv, x, y):
    """small open smile: corners, a pink tongue and the lower lip"""
    cv.put(x, y, MOUTH); cv.put(x + 2, y, MOUTH)
    cv.put(x + 1, y, TONGUE); cv.put(x + 1, y + 1, MOUTH)


# main fur/feather ramp per critter (light, base, dark, line); the app can recolour exactly these
MAIN_HEX = {
    'shiba': ('#ffbe73', '#f59a45', '#d47428', '#5e2a0e'),
    'cat': ('#c9cdd8', '#a6abbb', '#7f8597', '#30344a'),
    'penguin': ('#6aa6e8', '#3f7fd0', '#2c5fa8', '#14254a'),
    'hamster': ('#ffd9a0', '#f6b96b', '#d9934a', '#603414'),
    'rabbit': ('#ffffff', '#f4eef2', '#ddd0da', '#5e4a5c'),
    'frog': ('#a8e07a', '#7cc45a', '#5a9c40', '#1c401c'),
    'chick': ('#fff1a0', '#ffd95a', '#f0b832', '#6e4408'),
}
MAIN = {k: ramp(*v) for k, v in MAIN_HEX.items()}
CREAM = ramp('#fffaf0', '#fff1dc', '#ecd2b3', '#a8805c')
WHITE = ramp('#ffffff', '#f7f5f2', '#dcd8d3', '#8a8580')
PINK = hexc('#ffb3bd')


# ---------------------------------------------------------------- species (3/4 view, facing right)
def shiba(view, lift):
    O = MAIN['shiba']
    cv = Canvas()
    feet(cv, O, 'feet', lift)
    cv.layer(ellipse(12.2, 20.5, 5.8, 4.4), O, 'body')
    if view == 'front':
        cv.paint(ellipse(14.2, 21.6, 2.8, 3.2), CREAM[1], on='body')
    ears = union(tri((4.2, 9.0), (5.6, 0.8), (11.0, 4.8)), tri((14.6, 4.4), (19.6, 0.4), (21.4, 8.8)))
    cv.layer(ears, O, 'ears', shade_top=False)
    cv.layer(ellipse(12.8, 10.5, 10.6, 8.2), O, 'head')
    if view == 'front':
        cv.paint(union(tri((6.2, 6.6), (6.6, 3.0), (9.0, 5.2)), tri((16.2, 5.0), (19.0, 2.4), (19.6, 6.8))), PINK, on='ears')
        cv.paint(union(ellipse(13.5, 15.2, 4.6, 2.6), ellipse(6.6, 14.0, 2.4, 2.0), ellipse(20.4, 14.0, 2.4, 2.0)), CREAM[1], on='head')
        cv.put(9, 7, CREAM[1]); cv.put(17, 7, CREAM[1])                     # shiba brow dots
        face(cv, 9, nose=EYE)
    else:
        cv.layer(ellipse(10.2, 18.6, 3.2, 2.6), CREAM, 'tail')              # curled tail on the back
        cv.paint(ellipse(10.2, 18.6, 1.4, 1.1), O[1])
    cv.outline(lambda lid: O[3])
    return cv.image()


def cat(view, lift):
    G = MAIN['cat']     # silver tabby
    S = hexc('#6d7386')
    P = hexc('#ffb3c4')
    cv = Canvas()
    feet(cv, G, 'feet', lift)
    cv.layer(union(ellipse(4.2, 19.5, 2.0, 3.4), ellipse(3.0, 15.5, 1.4, 2.6)), G, 'tail')
    cv.layer(ellipse(12.2, 20.5, 5.6, 4.4), G, 'body')
    if view == 'front':
        cv.paint(ellipse(14.0, 21.6, 2.6, 3.2), WHITE[1], on='body')
    ears = union(tri((3.8, 8.0), (4.6, 0.4), (10.6, 4.0)), tri((15.0, 3.8), (20.6, 0.2), (21.6, 8.4)))
    cv.layer(ears, G, 'ears', shade_top=False)
    cv.layer(ellipse(12.8, 10.5, 10.6, 8.2), G, 'head')
    cv.paint(union(lambda x, y: x == 13 and 3 <= y <= 5, lambda x, y: x in (11, 15) and 4 <= y <= 5), S, on='head')
    if view == 'front':
        cv.paint(union(tri((5.6, 6.0), (5.6, 2.2), (8.4, 4.4)), tri((16.6, 4.4), (19.8, 2.0), (20.2, 6.4))), P, on='ears')
        cv.paint(ellipse(13.5, 15.2, 4.2, 2.4), WHITE[1], on='head')
        face(cv, 9, nose=P)
    else:
        cv.paint(lambda x, y: y in (17, 19, 21) and 9 <= x <= 16 and cv.part[y][x] == 'body', S)
    cv.outline(lambda lid: G[3])
    return cv.image()


def penguin(view, lift):
    B = MAIN['penguin']
    Wt = ramp('#ffffff', '#f4f8ff', '#d4e0f0', '#7a8aa6')
    Y = ramp('#ffe07a', '#ffc23d', '#e09a1c', '#8a5a10')
    cv = Canvas()
    feet(cv, Y, 'feet', lift, y=24)
    cv.layer(union(ellipse(4.6, 18.5, 1.8, 3.6), ellipse(20.6, 18.8, 1.6, 3.4)), B, 'wing')
    cv.layer(ellipse(12.5, 18.5, 7.4, 6.2), B, 'body')
    if view == 'front':
        cv.paint(ellipse(14.2, 20, 4.6, 4.6), Wt[1], on='body')
    cv.layer(ellipse(12.8, 10, 9.6, 8), B, 'head')
    cv.layer(union(lambda x, y: x == 13 and y in (1, 2), lambda x, y: x == 14 and y == 1), B, 'crest')
    if view == 'front':
        cv.paint(union(ellipse(9.5, 11.5, 3.6, 4.4), ellipse(17.5, 11.5, 3.6, 4.4), ellipse(13.5, 14.2, 6, 3.2)), Wt[1], on='head')
        face(cv, 9, mouth_=False)
        for x, y, c in ((12, 14, Y[1]), (13, 14, Y[1]), (14, 14, Y[1]), (13, 15, Y[2])):
            cv.put(x, y, c)                                                  # beak
    cv.outline(lambda lid: (Y if lid == 'feet' else B)[3])
    return cv.image()


def hamster(view, lift):
    O = MAIN['hamster']
    Wt = ramp('#ffffff', '#fff6ea', '#ecdcc8', '#9c7c5c')
    P = hexc('#ffaab8')
    cv = Canvas()
    feet(cv, ramp('#ffd0d8', '#ffb6c3', '#e48da0', '#9a4a5a'), 'feet', lift, y=24)
    cv.layer(union(ellipse(5.4, 4.8, 2.2, 2.4), ellipse(18.0, 4.2, 2.6, 2.6)), O, 'ears')
    cv.layer(ellipse(12.8, 14.5, 10.6, 10.2), O, 'head')
    if view == 'front':
        cv.paint(union(ellipse(5.4, 4.8, 1.0, 1.1), ellipse(18.0, 4.2, 1.2, 1.2)), P)
        cv.paint(ellipse(13.5, 20.5, 5.6, 4.4), Wt[1], on='head')
        cv.paint(union(ellipse(6.6, 16.4, 2.2, 1.8), ellipse(20.4, 16.4, 2.2, 1.8)), Wt[1], on='head')   # cheek pouches
        cv.paint(lambda x, y: x == 13 and 4 <= y <= 8, O[2])
        face(cv, 10, nose=P)
        cv.put(12, 19, Wt[3]); cv.put(16, 19, Wt[3])                        # tiny paws
    else:
        cv.paint(ellipse(10.5, 23, 1.6, 1.2), Wt[1])
    cv.outline(lambda lid: O[3] if lid != 'feet' else hexc('#9a4a5a'))
    return cv.image()


def rabbit(view, lift):
    R = MAIN['rabbit']
    P = hexc('#ffb6c8')
    cv = Canvas()
    feet(cv, R, 'feet', lift)
    cv.layer(ellipse(12.4, 20.5, 5.6, 4.4), R, 'body')
    # long ears: the far one leans back, the near one stands up
    ears = union(ellipse(9.0, 3.6, 1.8, 4.6), ellipse(16.0, 3.0, 2.0, 5.0))
    cv.layer(ears, R, 'ears', shade_top=False)
    cv.layer(ellipse(12.8, 12.0, 9.6, 7.4), R, 'head')
    if view == 'front':
        cv.paint(union(ellipse(9.0, 3.4, 0.7, 3.2), ellipse(16.0, 2.8, 0.9, 3.6)), P, on='ears')
        cv.paint(ellipse(14.6, 21.6, 2.6, 3.0), hexc('#fffdfd'), on='body')
        face(cv, 10, nose=P)
    else:
        cv.layer(ellipse(11.0, 20.0, 2.0, 1.8), WHITE, 'tail')
    cv.outline(lambda lid: R[3])
    return cv.image()


def frog(view, lift):
    F = MAIN['frog']
    Bl = ramp('#fffbe6', '#fff2c8', '#ead7a0', '#8a7a4a')
    cv = Canvas()
    feet(cv, F, 'feet', lift)
    cv.layer(ellipse(12.4, 19.5, 7.0, 5.0), F, 'body')
    if view == 'front':
        cv.paint(ellipse(14.4, 20.8, 4.2, 3.4), Bl[1], on='body')
    # wide head with two eye bumps on top
    cv.layer(union(ellipse(9.0, 6.4, 3.2, 3.2), ellipse(17.0, 6.4, 3.2, 3.2)), F, 'bumps')
    cv.layer(ellipse(13.0, 11.8, 10.2, 6.4), F, 'head')
    if view == 'front':
        face(cv, 4, mouth_=False, blush_dy=8)                                # eyes sit in the bumps
        for x in range(10, 17):
            cv.put(x, 13 if x in (10, 16) else 14, MOUTH)                     # wide smile
        cv.put(13, 15, TONGUE)
    cv.outline(lambda lid: F[3])
    return cv.image()


def chick(view, lift):
    Y = MAIN['chick']
    O = ramp('#ffc07a', '#ff9f43', '#e07a22', '#8a4a10')
    cv = Canvas()
    feet(cv, O, 'feet', lift, y=24)
    cv.layer(union(ellipse(4.4, 17.0, 1.6, 2.8), ellipse(20.8, 17.4, 1.4, 2.6)), Y, 'wing')
    # round fluff ball with a little tuft
    cv.layer(ellipse(12.8, 14.6, 9.4, 9.2), Y, 'head')
    cv.layer(union(lambda x, y: x in (12, 13) and y == 4, lambda x, y: x == 14 and y == 3, lambda x, y: x == 12 and y == 3), Y, 'tuft')
    if view == 'front':
        face(cv, 10, mouth_=False)
        for x, y, c in ((12, 15, O[1]), (13, 15, O[1]), (14, 15, O[1]), (13, 16, O[2])):
            cv.put(x, y, c)                                                  # beak
    cv.outline(lambda lid: (O if lid == 'feet' else Y)[3])
    return cv.image()


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
