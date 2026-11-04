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


EYE = hexc('#2b1f2e')
SHINE = hexc('#ffffff')
BLUSH = hexc('#ff9fb0')
MOUTH = hexc('#7a3b46')


EYE_MID = hexc('#7a5368')


def eyes(cv, y, gap=4, tall=3):
    """big sparkly eyes: 3 px wide, `tall`+1 px high, white shine top-left and a soft
    lower glint (same pattern on both eyes, so the light comes from one side)"""
    for side in (-1, 1):
        x0 = 12 + side * (gap + 1) - 1
        for dy in range(tall + 1):
            for dx in range(3):
                cv.put(x0 + dx, y + dy, EYE)
        cv.put(x0, y, SHINE)
        cv.put(x0 + 1, y + tall, EYE_MID)


def cheeks(cv, y, gap=7):
    cv.put(12 - gap, y, BLUSH)
    cv.put(12 - gap - 1, y, BLUSH)
    cv.put(12 + gap, y, BLUSH)
    cv.put(12 + gap + 1, y, BLUSH)


def feet(cv, rp, lid, lift=None, y=24):
    for side, x in (('L', 8.5), ('R', 16.5)):
        dy = -1 if lift == side else 0
        cv.layer(ellipse(x, y + 0.6 + dy, 2.6, 1.7), rp, lid)


# main fur/feather ramp per critter (light, base, dark, line); the app can recolour exactly these
MAIN_HEX = {
    'shiba': ('#ffbe73', '#f59a45', '#d47428', '#8a4418'),
    'cat': ('#c9cdd8', '#a6abbb', '#7f8597', '#454a5c'),
    'penguin': ('#6aa6e8', '#3f7fd0', '#2c5fa8', '#1d3a6b'),
    'hamster': ('#ffd9a0', '#f6b96b', '#d9934a', '#8a5426'),
}
MAIN = {k: ramp(*v) for k, v in MAIN_HEX.items()}


# ---------------------------------------------------------------- species
def shiba(view, lift):
    O = MAIN['shiba']
    C = ramp('#fffaf0', '#fff1dc', '#ecd2b3', '#a8805c')
    P = hexc('#ffb3bd')
    cv = Canvas()
    feet(cv, O, 'feet', lift)
    cv.layer(ellipse(12.5, 20.5, 5.6, 4.4), O, 'body')
    if view == 'front':
        cv.paint(ellipse(12.5, 21.5, 3.0, 3.4), C[1])
    ears = mirror(tri((3.0, 9.5), (4.4, 0.6), (10.5, 5.0)))
    cv.layer(ears, O, 'ears', shade_top=False)
    cv.layer(ellipse(12.5, 10.5, 10.6, 8.2), O, 'head')
    if view == 'front':
        cv.paint(mirror(tri((4.6, 7.0), (5.0, 2.6), (8.0, 5.4))), P, on='ears')  # inner ears
        cv.paint(union(ellipse(12.5, 15.6, 5.2, 2.6), mirror(ellipse(5.6, 14.2, 3.4, 2.6))), C[1], on='head')  # muzzle + cheeks
        cv.paint(mirror(lambda x, y: x == 8 and y == 8), C[1])                   # shiba brow dots
        eyes(cv, 10, gap=4)
        cv.put(12, 14, EYE)                                                      # nose
        cv.put(11, 15, MOUTH); cv.put(13, 15, MOUTH)
        cheeks(cv, 13, gap=7)
    else:
        # curled tail on the back
        cv.layer(union(ellipse(12.5, 19, 3.2, 2.6)), C, 'tail')
        cv.paint(ellipse(12.5, 19, 1.4, 1.1), O[1])
    cv.outline(lambda lid: O[3])
    return cv.image()


def cat(view, lift):
    G = MAIN['cat']     # silver tabby
    S = hexc('#6d7386')
    Wt = ramp('#ffffff', '#f7f5f2', '#dcd8d3', '#8a8580')
    P = hexc('#ffb3c4')
    cv = Canvas()
    feet(cv, G, 'feet', lift)
    # tail curling up on the right
    tail = union(ellipse(20.5, 20.5, 2, 3.4), ellipse(22, 16.5, 1.4, 2.6))
    cv.layer(tail, G, 'tail')
    cv.layer(ellipse(12.5, 20.5, 5.4, 4.4), G, 'body')
    if view == 'front':
        cv.paint(ellipse(12.5, 21.5, 2.8, 3.4), Wt[1])
    ears = mirror(tri((2.8, 8.5), (3.2, 0.4), (10.0, 4.2)))
    cv.layer(ears, G, 'ears', shade_top=False)
    cv.layer(ellipse(12.5, 10.5, 10.6, 8.2), G, 'head')
    # tabby forehead stripes (symmetric)
    cv.paint(union(lambda x, y: x == 12 and 3 <= y <= 5, mirror(lambda x, y: x == 10 and 4 <= y <= 5)), S, on='head')
    if view == 'front':
        cv.paint(mirror(tri((4.4, 6.4), (4.2, 2.2), (7.4, 4.6))), P, on='ears')
        cv.paint(ellipse(12.5, 15.4, 4.6, 2.6), Wt[1], on='head')
        eyes(cv, 10, gap=4)
        cv.put(12, 14, P)                                                         # nose
        cv.put(11, 15, MOUTH); cv.put(13, 15, MOUTH)
        cheeks(cv, 13, gap=7)
    else:
        cv.paint(union(lambda x, y: y in (16, 18, 21) and 9 <= x <= 15 and cv.part[y][x] == 'body'), S)
    cv.outline(lambda lid: G[3])
    return cv.image()


def penguin(view, lift):
    B = MAIN['penguin']
    Wt = ramp('#ffffff', '#f4f8ff', '#d4e0f0', '#7a8aa6')
    Y = ramp('#ffe07a', '#ffc23d', '#e09a1c', '#8a5a10')
    cv = Canvas()
    feet(cv, Y, 'feet', lift, y=24)
    # flippers
    cv.layer(mirror(ellipse(4.6, 18.5, 1.8, 3.6)), B, 'wing')
    cv.layer(ellipse(12.5, 18.5, 7.4, 6.2), B, 'body')
    if view == 'front':
        cv.paint(ellipse(12.5, 20, 4.8, 4.6), Wt[1])
    cv.layer(ellipse(12.5, 10, 9.6, 8), B, 'head')
    # little crest
    cv.layer(union(lambda x, y: x == 12 and y in (1, 2), lambda x, y: x == 13 and y == 1), B, 'crest')
    if view == 'front':
        cv.paint(union(mirror(ellipse(9.2, 11.5, 4.0, 4.6)), ellipse(12.5, 14, 6, 3.2)), Wt[1])   # heart face
        eyes(cv, 10, gap=3)
        for x, y, c in ((11, 13, Y[1]), (12, 13, Y[1]), (13, 13, Y[1]), (12, 14, Y[2])):
            cv.put(x, y, c)                                                        # beak
        cheeks(cv, 13, gap=5)
    cv.outline(lambda lid: (Y if lid == 'feet' else B)[3])
    return cv.image()


def hamster(view, lift):
    O = MAIN['hamster']
    Wt = ramp('#ffffff', '#fff6ea', '#ecdcc8', '#9c7c5c')
    P = hexc('#ffaab8')
    cv = Canvas()
    feet(cv, ramp('#ffd0d8', '#ffb6c3', '#e48da0', '#9a4a5a'), 'feet', lift, y=24)
    # one round bun: body and head as one blob
    cv.layer(mirror(ellipse(4.2, 4.6, 2.6, 2.6)), O, 'ears')
    cv.layer(ellipse(12.5, 14.5, 10.6, 10.2), O, 'head')
    if view == 'front':
        cv.paint(mirror(ellipse(4.2, 4.6, 1.2, 1.2)), P)
        cv.paint(ellipse(12.5, 20.5, 6.0, 4.4), Wt[1])
        cv.paint(mirror(ellipse(6.6, 16.2, 2.0, 1.6)), Wt[1])                   # cheek pouches
        cv.paint(lambda x, y: x == 12 and 5 <= y <= 9, O[2])                     # forehead stripe
        eyes(cv, 11, gap=4, tall=3)
        cv.put(12, 15, P)
        cv.put(11, 16, MOUTH); cv.put(13, 16, MOUTH)
        cheeks(cv, 14, gap=7)
        # tiny paws holding the belly
        cv.put(10, 19, Wt[3]); cv.put(14, 19, Wt[3])
    else:
        cv.paint(ellipse(12.5, 23, 1.6, 1.2), Wt[1])                             # stub tail
    cv.outline(lambda lid: O[3] if lid != 'feet' else hexc('#9a4a5a'))
    return cv.image()


CRITTERS = {'shiba': shiba, 'cat': cat, 'penguin': penguin, 'hamster': hamster}
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
