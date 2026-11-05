"""Menu bar icon frames (run `python3 gen_tray.py`): a small pixel pet that tells the state at a glance.

- run0..run3: the pet runs while agents work (the app plays them faster the more agents work)
- wait: the pet sits with a "!" when an agent waits for the user
- done: a check mark when work just finished
- idle: the pet naps (closed eye, "z") when nothing is going on
- off: an outline only when no agent is connected

18x18 monochrome templates (black + alpha) exported at @2x (36x36), one colour per pixel.
"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'src-tauri', 'icons')
N = 18

# side view, facing right: ears, round back, eye (hole), nose
BODY = [
    '.........x..x.....',
    '........xxxxxx....',
    '.xxxxxxxxxxxxxx...',
    'xxxxxxxxxxxx.xxx..',
    '.xxxxxxxxxxxxxxxx.',
    '.xxxxxxxxxxxxxxx..',
    '.xxxxxxxxxxxxxx...',
    '..xxxxxxxxxxxx....',
]
EYE = (3, 12)  # (row, col) inside BODY

# legs under the body for each running frame: columns of the two leg rows
LEGS = {
    0: ('..x.x......x.x....', '.x...x....x...x...'),
    1: ('...xx.......xx....', '...xx.......xx....'),
    2: ('...x.x.....x.x....', '..x...x...x...x...'),
    3: ('...xx.......xx....', '...xx.......xx....'),
}
TUCKED = ('..xxx.......xxx...', '..................')


def grid():
    return [['.'] * N for _ in range(N)]


def stamp(g, rows, top, left=0, ch='x'):
    for r, line in enumerate(rows):
        for c, v in enumerate(line):
            y, x = top + r, left + c
            if v == 'x' and 0 <= y < N and 0 <= x < N:
                g[y][x] = ch


def body(g, top, eye_open=True, hollow=False):
    stamp(g, BODY, top)
    ey, ex = EYE
    if eye_open:
        g[top + ey][ex] = '.'
    else:
        g[top + ey][ex - 1] = '.'
        g[top + ey][ex] = '.'
        g[top + ey + 1][ex] = 'x'
    if hollow:
        inner = [(y, x) for y in range(N) for x in range(N) if g[y][x] == 'x'
                 and all(0 <= y + dy < N and 0 <= x + dx < N and g[y + dy][x + dx] == 'x' for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)))]
        for y, x in inner:
            g[y][x] = '.'


def save(g, name):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    for y in range(N):
        for x in range(N):
            if g[y][x] == 'x':
                im.putpixel((x, y), (0, 0, 0, 255))
    im.resize((N * 2, N * 2), Image.NEAREST).save(os.path.join(OUT, f'tray_{name}.png'))


def main():
    for f, legs in LEGS.items():
        g = grid()
        top = 5 if f in (1, 3) else 6          # a little hop between strides
        body(g, top)
        stamp(g, legs, top + len(BODY))
        save(g, f'run{f}')

    g = grid()
    body(g, 7)
    stamp(g, TUCKED, 7 + len(BODY))
    stamp(g, ['xx', 'xx', 'xx', '..', 'xx'], 0, 15)  # "!"
    save(g, 'wait')

    g = grid()
    body(g, 7)
    stamp(g, TUCKED, 7 + len(BODY))
    stamp(g, ['.....x', '....xx', 'x..xx.', 'xxxx..', '.xx...'], 0, 12)  # check mark
    save(g, 'done')

    g = grid()
    body(g, 8, eye_open=False)
    stamp(g, ['..................', '.xxxxxxxxxxxxxx...'], 8 + len(BODY) - 1)
    stamp(g, ['xxxx', '..x.', '.x..', 'xxxx'], 1, 13)  # "z"
    save(g, 'idle')

    g = grid()
    body(g, 7, hollow=True)
    stamp(g, TUCKED, 7 + len(BODY))
    save(g, 'off')


if __name__ == '__main__':
    main()
