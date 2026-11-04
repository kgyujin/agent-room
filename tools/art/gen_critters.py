"""Built-in critter characters (single still images, 1 art pixel = 1 px).

Each body is authored as its left half and mirrored, so faces are exactly symmetric;
add-ons such as tails are placed afterwards. Rim shading (light top-left, dark
bottom-right) and the dark outline are applied automatically. The app animates the
still with hops and bobs. Run `python3 gen_critters.py` (writes app/public/assets/critters).
"""
import os
from pix import Spr, hexc

INK = hexc('#2f2326')

def mirror(half, odd=False):
    out = []
    for r in half:
        tail = r[::-1][1:] if odd else r[::-1]
        out.append(r + tail)
    return out

def render(rows, pal, tones, extra=()):
    """rows -> Spr with rim shading. tones: letter -> (light, base, dark) applied to that letter"""
    h, w = len(rows), len(rows[0])
    g = [list(r) for r in rows]
    for (x, y, ch) in extra:
        g[y][x] = ch
    filled = lambda x, y: 0 <= x < w and 0 <= y < h and g[y][x] != '.'
    s = Spr(w + 2, h + 2)
    for y in range(h):
        for x in range(w):
            ch = g[y][x]
            if ch == '.':
                continue
            c = pal[ch]
            if ch in tones:
                lt, dk = tones[ch]
                if (not filled(x + 1, y) and x > w // 2) or not filled(x, y + 1) or (x > w * 0.72 and not filled(x + 2, y)):
                    c = dk
                elif not filled(x, y - 1) and x < w * 0.6:
                    c = lt
            s.put(x + 1, y + 1, c)
    s.outline(color=INK)
    return s


X = {'k': INK, 'e': hexc('#2a1d22'), 'h': hexc('#ffffff'), 'n': hexc('#2a1d22'), 'p': hexc('#f7a3a8'), 'm': hexc('#d9607a')}

def eyes_fix(rows, w, cols, row):
    """mirrored right eye has its highlight on the outside: move it to the top-left"""
    g = [list(r) for r in rows]
    a, b = w - 1 - cols[0], w - 1 - cols[1]   # right eye columns (b < a)
    g[row][b], g[row][a] = 'h', 'e'
    return [''.join(r) for r in g]

SHIBA = mirror([
    "..o........",
    ".ooO.......",
    ".oiOO......",
    ".oiiOO.....",
    ".oiiOOOOOOO",
    "ooOOOOOOOOO",
    "oOOOOWOOOOO",
    "OOOOOOOOOOO",
    "OOOOOheOOOO",
    "OOOOWeeWWWW",
    "OOWWWeeWWWW",
    "OWWWWWWWWnn",
    "OWWpWWWWWWn",
    ".WWWWWWWkWW",
    "..WWWWWWWkk",
    "...OWWWWWWW",
    "...OOWWWWWW",
    "...OOWWWWWW",
    "...OOWWWWWW",
    "..OOWWWWWWk",
    "..OOWWWWWWk",
    "...OOWWWWWk",
], odd=True)
SHIBA = eyes_fix(SHIBA, 21, (5, 6), 8)
dog_pal = {**X, 'O': hexc('#e8944a'), 'o': hexc('#f4b26a'), 'W': hexc('#fff3e2'), 'i': hexc('#f6c3a8')}
dog_t = {'O': (hexc('#f4b26a'), hexc('#c4712f')), 'W': (hexc('#ffffff'), hexc('#e6cfb2'))}

CAT = mirror([
    ".G.........",
    ".GG........",
    ".GpG.......",
    ".GppG......",
    ".GppGGGsGsG",
    "GGGGGGGGsGs",
    "sGGGGGGGGsG",
    "GGGGGGGGGGG",
    "sGGGGheGGGG",
    "GGGGGeeGGGG",
    "sGWWWggWWWW",
    "GWWWWWWWWWm",
    "GWWpWWWWWWk",
    ".WWWWWWWWkW",
    "..WWWWWWWWW",
    "...GWWWWWWW",
    "...sGWWWWWW",
    "...GGWWWWWW",
    "...sGWWWWWW",
    "..GGGWWWWWk",
    "..GGWWWWWWk",
    "...GGWWWWWk",
], odd=True)
CAT = eyes_fix(CAT, 21, (5, 6), 8)
cat_pal = {**X, 'G': hexc('#b9a189'), 's': hexc('#7a604d'), 'W': hexc('#fffaf3'), 'g': hexc('#8fcf74')}
cat_t = {'G': (hexc('#d2bea7'), hexc('#977e69')), 'W': (hexc('#ffffff'), hexc('#e8ddd2'))}

def pad(rows, n):
    return [r + '.' * n for r in rows]

dtail = [(20, 14, 'o'), (21, 14, 'o'), (19, 15, 'O'), (20, 15, 'W'), (21, 15, 'W'), (22, 15, 'O'), (18, 16, 'O'), (19, 16, 'O'), (21, 16, 'W'), (22, 16, 'O'), (18, 17, 'O'), (19, 17, 'O'), (20, 17, 'O'), (21, 17, 'O')]
ctail = [(18, 21, 'G'), (19, 21, 'G'), (20, 21, 'G'), (20, 20, 'G'), (21, 20, 'G'), (21, 19, 's'), (22, 19, 'G'), (21, 18, 'G'), (22, 18, 's'), (21, 17, 'G'), (22, 17, 'G'), (21, 16, 's'), (22, 16, 'G'), (21, 15, 'G')]
CRITTERS = {
    'shiba': lambda: render(pad(SHIBA, 3), dog_pal, dog_t, dtail),
    'cat': lambda: render(pad(CAT, 4), cat_pal, cat_t, ctail),
}


OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'public', 'assets', 'critters')


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    for name, make in CRITTERS.items():
        make().im.save(os.path.join(OUT, f'{name}.png'))
    print('critters written:', ', '.join(CRITTERS))


if __name__ == '__main__':
    main()
