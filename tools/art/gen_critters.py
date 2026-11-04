"""Built-in critters: hand-placed pixel art, 1 art pixel = 1 px, one colour per pixel.

Style: chubby "loaf" sticker critters. A solid dark outline, one flat fill, one shadow
tone down the right side and along the bottom, single-pixel eyes set wide apart, a tiny
'ㅅ' mouth and pink cheeks. Faces look straight at the viewer.

Every critter shares one body: a rounded block 19 px wide (columns 0-18, centre 9) and
15 rows tall (rows 3-17), drawn symmetric, with species details stamped on top. The
outline is added around whatever was filled. Output per critter is a 6-frame strip the
app slices: front, walk front x2, back, walk back x2.
Run `python3 gen_critters.py` (writes app/public/assets/critters).
"""
import json
import os
from PIL import Image

W, H = 25, 27           # frame size the app expects
OX, OY = 2, 7           # where design (0, 0) lands in the frame


def hexc(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


INK = hexc('#2a2230')
WHITE = hexc('#fffaf4')
WHITE_D = hexc('#e9ded4')
PINK = hexc('#ffb3c4')
BLUSH = hexc('#ff9db0')

# main fur ramp per critter (light, base, shadow, spare); the app recolours exactly these
MAIN_HEX = {
    'cat': ('#c8cad3', '#aeb0bb', '#8b8e9b', '#6f7280'),
    'shiba': ('#ffc27a', '#f6a04d', '#d97f30', '#b8641e'),
    'penguin': ('#7fb0ec', '#5a8fdc', '#3d6cb8', '#2b5294'),
    'hamster': ('#ffdcaa', '#f6be7a', '#dc9c58', '#bb7e3c'),
    'rabbit': ('#ffffff', '#f7f2f5', '#e0d5dd', '#c4b6c1'),
    'frog': ('#a9e27c', '#86cc60', '#64a646', '#4c8836'),
    'chick': ('#fff3a8', '#ffdd5e', '#f2bb34', '#d49a1c'),
}
MAIN = {k: tuple(hexc(c) for c in v) for k, v in MAIN_HEX.items()}
ORANGE = (hexc('#ffb04a'), hexc('#e88a26'))
CREAM = hexc('#fff1c9')


class Sprite:
    def __init__(self):
        self.px = {}

    def put(self, x, y, c):
        self.px[(x, y)] = c

    def get(self, x, y):
        return self.px.get((x, y))

    def fill(self, cells, c):
        for p in cells:
            self.px[p] = c

    def outline(self):
        add = []
        for (x, y) in list(self.px):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n not in self.px:
                    add.append(n)
        for p in add:
            self.px[p] = INK

    def image(self, flip=False):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            fx, fy = OX + x, OY + y
            if 0 <= fx < W and 0 <= fy < H:
                im.putpixel((fx, fy), c)
        return im


def mirror(cells):
    """cells on the left half (x <= 9) plus their mirror image across column 9"""
    return set(cells) | {(18 - x, y) for (x, y) in cells}


def body_cells(top=3, bottom=17):
    """the loaf: full width rows, corners clipped one pixel"""
    cells = set()
    for y in range(top, bottom + 1):
        x0 = 1 if y in (top, bottom) else 0
        for x in range(x0, 19 - x0):
            cells.add((x, y))
    return cells


def shade(s, cells, dark):
    """shadow tone on the right column and the bottom row of `cells`"""
    for (x, y) in cells:
        if (x + 1, y) not in cells or (x, y + 1) not in cells:
            s.put(x, y, dark)


def face(s, y=10, eye=INK):
    for x in (5, 13):
        s.put(x, y, eye)
    s.put(9, y, INK); s.put(8, y + 1, INK); s.put(10, y + 1, INK)      # 'ㅅ' mouth
    for x in (3, 4, 14, 15):
        s.put(x, y + 1, BLUSH)


def legs(s, lift, ys=(16, 17)):
    """two leg gaps under the loaf; walking slides them left/right a pixel"""
    shift = {'L': -1, 'R': 1}.get(lift, 0)
    for x in (6 + shift, 12 + shift):
        for y in ys:
            s.put(x, y, INK)


def pointed_ears(s, base, inner):
    s.fill(mirror({(2, 0), (1, 1), (2, 1), (3, 1), (1, 2), (2, 2), (3, 2), (4, 2)}), base)
    s.fill(mirror({(2, 1), (2, 2), (3, 2)}), inner)


# ---------------------------------------------------------------- species
def cat(view, lift):
    L, B, D, _ = MAIN['cat']
    s = Sprite()
    pointed_ears(s, B, D)
    body = body_cells()
    s.fill(body, B)
    # tail curling up the right side
    tail = {(19, 16), (20, 16), (20, 15), (21, 15), (21, 14), (21, 13), (21, 12), (20, 11), (21, 11)}
    s.fill(tail, B)
    s.put(21, 13, D); s.put(20, 16, D)
    shade(s, body, D)
    # tabby marks: forehead and flanks
    for p in [(9, 3), (9, 4), (7, 3), (11, 3)]:
        s.put(*p, D)
    for y in (11, 13):
        s.put(0, y, D); s.put(1, y, D); s.put(17, y, D)
    if view == 'front':
        face(s)
    else:
        for y in (7, 9, 11):
            for x in range(7, 12):
                s.put(x, y, D)
    legs(s, lift)
    s.outline()
    return s.image()


def shiba(view, lift):
    L, B, D, _ = MAIN['shiba']
    s = Sprite()
    pointed_ears(s, B, PINK if view == 'front' else D)
    body = body_cells()
    s.fill(body, B)
    tail = {(19, 12), (20, 12), (20, 11), (21, 11), (21, 12), (21, 13), (20, 13), (19, 13)}   # curled tail
    s.fill(tail, B)
    s.put(20, 12, WHITE)
    shade(s, body, D)
    if view == 'front':
        # cream muzzle and chest
        s.fill({(x, y) for x in range(6, 13) for y in (11, 12)} | {(x, 13) for x in range(5, 14)}
               | {(x, y) for x in range(6, 13) for y in (14, 15, 16)}, WHITE)
        s.put(5, 7, WHITE); s.put(13, 7, WHITE)                               # brow dots
        face(s)
    legs(s, lift)
    s.outline()
    return s.image()


def penguin(view, lift):
    L, B, D, _ = MAIN['penguin']
    s = Sprite()
    s.fill({(9, 1), (8, 2), (9, 2), (10, 2)}, B)                             # tuft
    body = body_cells(top=3)
    s.fill(body, B)
    s.fill({(-1, y) for y in range(9, 14)} | {(19, y) for y in range(9, 14)}, B)   # flippers
    shade(s, body, D)
    if view == 'front':
        s.fill({(x, y) for y in range(6, 17) for x in range(3, 16) if not (y in (6, 16) and x in (3, 15))}, WHITE)
        face(s)
        s.put(9, 10, ORANGE[0]); s.put(9, 11, ORANGE[1])                      # beak replaces the mouth
        s.put(8, 11, WHITE); s.put(10, 11, WHITE)
    for x in (5, 6, 12, 13):
        s.put(x + {'L': -1, 'R': 1}.get(lift, 0) * (1 if x < 9 else 0), 18, ORANGE[0])  # feet
    s.outline()
    return s.image()


def hamster(view, lift):
    L, B, D, _ = MAIN['hamster']
    s = Sprite()
    s.fill(mirror({(2, 1), (3, 1), (2, 2), (3, 2)}), B)                      # round ears
    if view == 'front':
        s.fill(mirror({(2, 2), (3, 2)}), PINK)
    body = body_cells()
    s.fill(body, B)
    shade(s, body, D)
    if view == 'front':
        s.fill({(x, y) for y in range(12, 17) for x in range(2, 17) if not (y == 12 and x in (2, 16))}, WHITE)
        for x in (2, 3, 15, 16):
            s.put(x, 12, WHITE)
        face(s)
    legs(s, lift)
    s.outline()
    return s.image()


def rabbit(view, lift):
    L, B, D, _ = MAIN['rabbit']
    s = Sprite()
    s.fill(mirror({(x, y) for x in (4, 5) for y in range(-5, 3)}), B)       # long ears
    if view == 'front':
        s.fill(mirror({(4, y) for y in range(-4, 2)}), PINK)
    body = body_cells()
    s.fill(body, B)
    shade(s, body, D)
    if view == 'front':
        face(s)
    else:
        s.fill({(8, 14), (9, 14), (10, 14), (9, 13)}, WHITE)                 # cotton tail
    legs(s, lift)
    s.outline()
    return s.image()


def frog(view, lift):
    L, B, D, _ = MAIN['frog']
    s = Sprite()
    bump = {(x, y) for x in range(1, 6) for y in range(0, 4) if not (y == 0 and x in (1, 5))}
    s.fill(mirror(bump), B)
    body = body_cells(top=3)
    s.fill(body, B)
    shade(s, body, D)
    if view == 'front':
        s.fill({(x, y) for y in range(13, 17) for x in range(4, 15) if not (y == 13 and x in (4, 14))}, CREAM)
        for x in (3, 15):
            s.put(x, 1, INK); s.put(x, 2, INK)                               # eyes in the bumps
        for x in range(6, 13):
            s.put(x, 9 if x in (6, 12) else 10, INK)                         # wide smile
        for x in (2, 3, 15, 16):
            s.put(x, 8, BLUSH)
    legs(s, lift)
    s.outline()
    return s.image()


def chick(view, lift):
    L, B, D, _ = MAIN['chick']
    s = Sprite()
    s.fill({(9, 0), (8, 1), (10, 1), (9, 2)}, B)                              # tuft
    body = body_cells(top=3)
    s.fill(body, B)
    s.fill({(-1, y) for y in range(10, 14)} | {(19, y) for y in range(10, 14)}, B)   # wings
    shade(s, body, D)
    if view == 'front':
        face(s)
        s.put(9, 10, ORANGE[0]); s.put(8, 11, B); s.put(10, 11, B); s.put(9, 11, ORANGE[1])   # beak
    for x in (6, 12):
        dx = {'L': -1, 'R': 1}.get(lift, 0) if x == 6 else 0
        s.put(x + dx, 18, ORANGE[1]); s.put(x + dx + 1, 18, ORANGE[1])        # feet
    s.outline()
    return s.image()


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
            strip.alpha_composite(make(view, lift), (i * W, -1 if lift else 0))   # hop a pixel while walking
        strip.save(os.path.join(OUT, f'{name}.png'))
    with open(os.path.join(OUT, 'critters.json'), 'w') as f:
        json.dump({k: list(v) for k, v in MAIN_HEX.items()}, f)
    print('critters written:', ', '.join(CRITTERS))


if __name__ == '__main__':
    main()
