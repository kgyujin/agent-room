"""Menu bar icon frames (run `python3 gen_tray.py`): a small front-facing pixel cat that tells the state at a glance.

- run0..run3: the cat types on a laptop while agents work (the app plays them faster the more agents work)
- wait: the cat sits up wide-eyed with a "!" when an agent waits for the user
- done: the cat smiles with closed eyes next to a check mark when work just finished
- idle: the cat naps as a loaf (closed eyes, "z") when nothing is going on
- off: an outline only when no agent is connected

18x18 monochrome templates (black + alpha) exported at @2x (36x36), one colour per pixel.
Eyes, mouth and the laptop's inside are holes, so the menu bar tints them like the rest.
"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'src-tauri', 'icons')
N = 18

# 12x9 head with pointy ears; faces cut eyes (rows 3-4) and the mouth (rows 6-7) out of it
HEAD = [
    '.x........x.',
    '.xx......xx.',
    '.xxxxxxxxxx.',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    '.xxxxxxxxxx.',
]
# holes per face as (row, col) inside HEAD
FACES = {
    # dot eyes and a small smiling mouth
    'open': [(3, 3), (4, 3), (3, 8), (4, 8), (6, 4), (6, 7), (7, 5), (7, 6)],
    'wide': [(3, 2), (3, 3), (4, 2), (4, 3), (3, 8), (3, 9), (4, 8), (4, 9), (6, 4), (6, 7), (7, 5), (7, 6)],
    'happy': [(3, 3), (4, 2), (4, 4), (3, 8), (4, 7), (4, 9), (6, 4), (6, 7), (7, 5), (7, 6)],
    'sleep': [(4, 2), (4, 3), (4, 8), (4, 9), (6, 4), (6, 7), (7, 5), (7, 6)],
    'none': [],
}

# sitting body under the head (same 12 columns plus a tail on the right)
BODY = [
    '..xxxxxxxx....',
    '.xxxxxxxxxx...',
    '.xxxxxxxxxx...',
    '.xxxxxxxxxx.x.',
    '.xxxxxxxxxx.x.',
    '.xxxxxxxxxxxx.',
    '.xxxx..xxxx...',
    '.xxxx..xxxx...',
]

LAPTOP = [
    'xxxxxxxxxxxxxxxx',
    'x..............x',
    'x..............x',
    'x..............x',
    'xxxxxxxxxxxxxxxx',
]


def grid():
    return [['.'] * N for _ in range(N)]


def stamp(g, rows, top, left=0, ch='x'):
    for r, line in enumerate(rows):
        for c, v in enumerate(line):
            y, x = top + r, left + c
            if v == 'x' and 0 <= y < N and 0 <= x < N:
                g[y][x] = ch


def head(g, top, left, face):
    stamp(g, HEAD, top, left)
    for r, c in FACES[face]:
        g[top + r][left + c] = '.'


def clear(g, cells):
    for y, x in cells:
        if 0 <= y < N and 0 <= x < N:
            g[y][x] = '.'


def hollow(g):
    inner = [(y, x) for y in range(N) for x in range(N) if g[y][x] == 'x'
             and all(0 <= y + dy < N and 0 <= x + dx < N and g[y + dy][x + dx] == 'x' for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)))]
    clear(g, inner)


def sitting(g, face, left=1):
    head(g, 0, left, face)
    stamp(g, BODY, 9, left - 1)


def save(g, name):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    for y in range(N):
        for x in range(N):
            if g[y][x] == 'x':
                im.putpixel((x, y), (0, 0, 0, 255))
    im.resize((N * 2, N * 2), Image.NEAREST).save(os.path.join(OUT, f'tray_{name}.png'))


def main():
    # typing: paws tap the laptop in turn, the head bobs while both paws are down
    PAW = ['xx', 'xx']
    for f, (left_up, right_up) in enumerate(((True, False), (False, False), (False, True), (False, False))):
        g = grid()
        bob = 0 if (left_up or right_up) else 1
        head(g, bob, 3, 'open')
        stamp(g, LAPTOP, 13, 1)
        stamp(g, PAW, 9 if left_up else 11, 2)
        stamp(g, PAW, 9 if right_up else 11, 14)
        save(g, f'run{f}')

    g = grid()
    sitting(g, 'wide', left=0)
    stamp(g, ['xx', 'xx', 'xx', 'xx', '..', 'xx'], 0, 15)  # "!"
    save(g, 'wait')

    g = grid()
    sitting(g, 'happy', left=0)
    stamp(g, ['....x', '...xx', 'x.xx.', 'xxx..', '.x...'], 0, 13)  # check mark
    save(g, 'done')

    g = grid()
    head(g, 6, 1, 'sleep')
    stamp(g, ['.xxxxxxxxxxxxxxx', 'xxxxxxxxxxxxxxxx', '.xxxxxxxxxxxxxx.'], 15, 0)  # loaf body
    stamp(g, ['xxx', '.x.', 'xxx'], 0, 15)  # "z"
    stamp(g, ['xx', 'x.', 'xx'], 3, 12)     # small "z"
    clear(g, [(3, 13)])
    save(g, 'idle')

    g = grid()
    sitting(g, 'none', left=3)
    hollow(g)
    save(g, 'off')


if __name__ == '__main__':
    main()
