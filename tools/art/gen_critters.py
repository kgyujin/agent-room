"""Built-in critters: hand-placed pixel art, 1 art pixel = 1 px, one colour per pixel.

Style: chubby "loaf" sticker critters (dark outline, flat fills, dot eyes set wide apart,
tiny 'ㅅ' mouth, pink cheeks), turned to the room's isometric angle. The loaf is a rounded
block seen from above-front: a light top, the wide face on the left-front side and the
short flank on the right-front side in shadow, so it stands on the same floor grid as
the furniture.

Body geometry (frame pixels): the front vertical edge sits between columns C-1 and C.
The face runs left from it for FW columns and rises 1 row every 4 columns; the flank runs
right for SW columns and rises 1 row every 2 columns (the room's 2:1 slope).
The front view faces down-left (the app mirrors it for right); the back view is the same
block mirrored with the back on the wide side.
Output per critter: 6-frame strip front, walk front x2, back, walk back x2.
Run `python3 gen_critters.py` (writes app/public/assets/critters).
"""
import json
import os
from PIL import Image

W, H = 25, 27            # frame size the app expects
C = 15                   # front edge: face is columns C-FW..C-1, flank C..C+SW-1
FW, SW = 13, 5           # face width, flank width
BASE = 24                # bottom row of the body at the front edge
BH = 12                  # body height at the front edge


def hexc(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


INK = hexc('#2a2230')
WHITE = hexc('#fffaf4')
PINK = hexc('#ffb3c4')
BLUSH = hexc('#ff9db0')

# main fur ramp per critter (light, base, shadow, deep); the app recolours exactly these
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
CREAM_D = hexc('#f0dcae')


# ---------------------------------------------------------------- geometry
def f_rise(i):
    """rows the face's edges climb, i columns left of the front edge"""
    return i // 4


def s_rise(j):
    return j // 2


def F(i, h):
    """face point: i columns left of the front edge, h rows above the face's bottom row"""
    return (C - 1 - i, BASE - f_rise(i) - h)


def S(j, h):
    """flank point: j columns right of the front edge, h rows above the flank's bottom row"""
    return (C + j, BASE - s_rise(j) - h)


def Fc(i, h):
    """face point without the per-column rise; for small upright details centred near i"""
    return (C - 1 - i, BASE - f_rise(round(i)) - h)


class Sprite:
    def __init__(self):
        self.px = {}

    def put(self, p, c):
        self.px[p] = c

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

    def image(self, mirror=False):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            fx = W - 1 - x if mirror else x
            if 0 <= fx < W and 0 <= y < H:
                im.putpixel((fx, y), c)
        return im


def body(s, ramp, bh=BH):
    """the loaf: light top, base face, shadow flank; rounded where the faces meet the top"""
    L, B, D, X = ramp
    top_face = BASE - bh            # top row of the face at the front edge
    face, flank, top = set(), set(), set()
    for i in range(FW):
        x, y0 = C - 1 - i, top_face - f_rise(i)
        for y in range(y0 + 1, BASE - f_rise(i) + 1):
            face.add((x, y))
    for j in range(SW):
        x, y0 = C + j, top_face - s_rise(j)
        for y in range(y0 + 1, BASE - s_rise(j) + 1):
            flank.add((x, y))
    # top: bounded in front by the face/flank top rows and behind by two back edges
    lx, ly = C - FW, top_face - f_rise(FW - 1)          # left corner
    rx, ry = C + SW - 1, top_face - s_rise(SW - 1)      # right corner
    for x in range(lx, rx + 1):
        front = top_face - (f_rise(C - 1 - x) if x < C else s_rise(x - C))
        back = max(ly - (x - lx) // 2, ry - (rx - x) // 4)
        for y in range(back, front + 1):
            top.add((x, y))
    # round off: drop the three outer corners of the top and the bottom corners
    for p in [(lx, ly), (lx + 1, ly), (lx, ly + 1), (lx, ly + 2), (rx, ry), (rx - 1, ry), (rx, ry + 1), (rx, ry + 2)]:
        top.discard(p); face.discard(p); flank.discard(p)
    bx = min(range(lx, rx + 1), key=lambda x: max(ly - (x - lx) // 2, ry - (rx - x) // 4))
    top.discard((bx, max(ly - (bx - lx) // 2, ry - (rx - bx) // 4)))
    for p in [(lx, BASE - f_rise(FW - 1)), (lx + 1, BASE - f_rise(FW - 2)), (lx, BASE - f_rise(FW - 1) - 1)]:
        face.discard(p)
    for p in [(rx, BASE - s_rise(SW - 1)), (rx, BASE - s_rise(SW - 1) - 1)]:
        flank.discard(p)
    s.fill(top, L)
    s.fill(face, B)
    s.fill(flank, D)
    for p in face:                                   # face bottom row in shadow
        if (p[0], p[1] + 1) not in face:
            s.put(p, D)
    for p in flank:
        if (p[0], p[1] + 1) not in flank:
            s.put(p, X)
    # the rounded front edge: top's front row and the corner column read as one soft bend
    s.put((C - 1, top_face), L); s.put((C, top_face), L)
    return top, face, flank


def eyes_mouth(s, h=5, eye=INK, mouth=True, blush=True):
    # eyes two pixels tall, set wide apart around the mouth
    for i in (2, 10):
        s.put(F(i, h), eye)
        s.put(F(i, h + 1), eye)
    if mouth:
        mx, my = F(6, h)
        s.put((mx, my), INK); s.put((mx - 1, my + 1), INK); s.put((mx + 1, my + 1), INK)
    if blush:
        for i in (1, 2):
            s.put(F(i - 1, h - 1), BLUSH)
        for i in (10, 11):
            s.put(F(i + 1, h - 1), BLUSH)


def legs(s, lift):
    """dark gaps between the feet on the face's bottom row; walking slides them"""
    sh = {'L': -1, 'R': 1}.get(lift, 0)
    for i in (3 + sh, 9 + sh):
        s.put(F(i, 0), INK)
    s.put(S(3 - sh, 0), INK)


def ear(s, base_x, base_y, col, inner=None):
    """small pointed ear standing on the top, 3 wide at its base"""
    s.fill({(base_x + dx, base_y - dy) for dy in range(4) for dx in range(-1 if dy < 2 else 0, 2 if dy < 3 else 1)} | {(base_x + 1, base_y - 2)}, col)
    if inner:
        s.put((base_x, base_y - 1), inner); s.put((base_x, base_y - 2), inner)


def ear_spots():
    """two ear bases on the top, near its front edge, above each eye"""
    tf = BASE - BH
    a = F(10, 0)[0] + 1, tf - f_rise(10) - 2
    b = F(3, 0)[0] + 1, tf - f_rise(3) - 3
    return a, b


# ---------------------------------------------------------------- species
def cat(view, lift):
    L, B, D, X = MAIN['cat']
    s = Sprite()
    # tail curling up behind the right corner (drawn first so the body sits on top)
    tx = C + SW - 2
    ty = BASE - BH - s_rise(SW - 1)
    s.fill({(tx + 1, ty + 4), (tx + 2, ty + 3), (tx + 2, ty + 2), (tx + 2, ty + 1), (tx + 1, ty), (tx + 2, ty)}, B)
    top, face, flank = body(s, MAIN['cat'])
    for (x, y) in ear_spots():
        ear(s, x, y, B, D if view == 'front' else None)
    s.put((tx + 2, ty + 2), D)
    # tabby: stripes over the top, two on the flank
    for i in (4, 7, 10):
        x, y = F(i, BH)
        for k in range(4):
            p = (x + k, y - k // 2)
            if p in top:
                s.put(p, D)
    for h in (3, 5):
        s.put(S(1, h), X); s.put(S(2, h), X)
    if view == 'front':
        eyes_mouth(s)
    else:
        for h in (2, 4, 6):
            for i in range(4, 9):
                s.put(F(i, h), D)
    legs(s, lift)
    s.outline()
    return s.image(mirror=view == 'back')


def shiba(view, lift):
    L, B, D, X = MAIN['shiba']
    s = Sprite()
    tx = C + SW - 2
    ty = BASE - BH - s_rise(SW - 1)
    s.fill({(tx + 1, ty + 1), (tx + 2, ty + 1), (tx + 2, ty), (tx + 1, ty - 1), (tx + 2, ty - 1), (tx + 3, ty)}, B)
    body(s, MAIN['shiba'])
    for (x, y) in ear_spots():
        ear(s, x, y, B, PINK if view == 'front' else D)
    s.put((tx + 2, ty), WHITE)
    if view == 'front':
        # cream muzzle and chest
        for i in range(3, 10):
            for h in range(1, 5 if 4 <= i <= 8 else 3):
                s.put(F(i, h), WHITE)
        eyes_mouth(s)
    legs(s, lift)
    s.outline()
    return s.image(mirror=view == 'back')


def penguin(view, lift):
    L, B, D, X = MAIN['penguin']
    s = Sprite()
    tx, ty = F(6, BH + 1)
    s.fill({(tx, ty - 2), (tx - 1, ty - 1), (tx, ty - 1), (tx + 1, ty - 1)}, B)   # tuft
    body(s, MAIN['penguin'])
    # flippers on both sides
    for h in range(3, 7):
        s.put((C - FW - 1, BASE - f_rise(FW - 1) - h), B)
    if view == 'front':
        for i in range(1, 12):
            for h in range(1, 9):
                if not ((i in (1, 11)) and h in (1, 8)):
                    s.put(F(i, h), WHITE)
        eyes_mouth(s, mouth=False)
        mx, my = F(6, 5)
        s.put((mx, my), ORANGE[0]); s.put((mx, my + 1), ORANGE[1])
    else:
        pass
    sh = {'L': -1, 'R': 1}.get(lift, 0)
    for i in (3, 4, 8, 9):
        x, y = F(i + (sh if i < 6 else 0), 0)
        s.put((x, y + 1), ORANGE[0])
    s.outline()
    return s.image(mirror=view == 'back')


def hamster(view, lift):
    L, B, D, X = MAIN['hamster']
    s = Sprite()
    body(s, MAIN['hamster'])
    for (x, y) in ear_spots():
        s.fill({(x, y), (x + 1, y), (x + 2, y), (x, y - 1), (x + 1, y - 1), (x + 2, y - 1)}, B)
        if view == 'front':
            s.put((x + 1, y), PINK)
    if view == 'front':
        for i in range(1, 12):
            for h in range(1, 4):
                s.put(F(i, h), WHITE)
        eyes_mouth(s)
    legs(s, lift)
    s.outline()
    return s.image(mirror=view == 'back')


def rabbit(view, lift):
    L, B, D, X = MAIN['rabbit']
    s = Sprite()
    body(s, MAIN['rabbit'])
    for (x, y) in ear_spots():
        for yy in range(y - 7, y + 1):
            s.put((x, yy), B); s.put((x + 1, yy), B)
        if view == 'front':
            for yy in range(y - 6, y):
                s.put((x, yy), PINK)
    if view == 'front':
        eyes_mouth(s)
    else:
        for (i, h) in [(5, 3), (6, 3), (7, 3), (6, 4), (5, 2), (6, 2), (7, 2)]:
            s.put(F(i, h), D)                          # cotton tail ring
        s.put(F(6, 3), WHITE)
    legs(s, lift)
    s.outline()
    return s.image(mirror=view == 'back')


def frog(view, lift):
    L, B, D, X = MAIN['frog']
    s = Sprite()
    body(s, MAIN['frog'])
    for (x, y) in ear_spots():
        s.fill({(x + dx, y + dy) for dx in range(-1, 4) for dy in (-2, -1, 0) if not (dy == -2 and dx in (-1, 3))}, B)
        if view == 'front':
            s.put((x + 1, y - 1), INK)                 # eyes in the bumps
            s.put((x + 1, y - 2), INK)
    if view == 'front':
        for i in range(2, 11):
            for h in range(1, 4):
                s.put(F(i, h), CREAM)
        for i in range(3, 10):
            s.put(F(i, 6 if i in (3, 9) else 5), INK)  # wide smile
        for i in (0, 1, 11, 12):
            s.put(F(i, 6), BLUSH)
    legs(s, lift)
    s.outline()
    return s.image(mirror=view == 'back')


def chick(view, lift):
    L, B, D, X = MAIN['chick']
    s = Sprite()
    tx, ty = F(6, BH + 1)
    s.fill({(tx, ty - 3), (tx - 1, ty - 2), (tx + 1, ty - 2), (tx, ty - 1)}, B)   # tuft
    body(s, MAIN['chick'])
    for h in range(3, 6):
        s.put((C - FW - 1, BASE - f_rise(FW - 1) - h), B)                         # wing
    if view == 'front':
        eyes_mouth(s, mouth=False)
        mx, my = F(6, 5)
        s.put((mx, my), ORANGE[0]); s.put((mx, my + 1), ORANGE[1])
    sh = {'L': -1, 'R': 1}.get(lift, 0)
    for i in (3, 9):
        x, y = F(i + (sh if i < 6 else 0), 0)
        s.put((x, y + 1), ORANGE[1]); s.put((x - 1, y + 1), ORANGE[1])
    s.outline()
    return s.image(mirror=view == 'back')


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
