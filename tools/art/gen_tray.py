"""Menu bar icon frames (run `python3 gen_tray.py`): the shiba from the app icon, in colour, telling the state at a glance.

- run0..run3: the shiba waddles while agents work (the app plays them faster the more agents work)
- wait: a "!" bubble when an agent waits for the user
- done: a check bubble when work just finished
- idle: "z"s when nothing is going on
- off: a faded grey shiba when no agent is connected

44 px tall colour images (not templates). The app shows them at 2 px per point (22pt tall, as tall
as other apps' menu bar icons), so the shiba is drawn two pixels per art pixel. One colour per pixel.
These are the bundled defaults; the app draws the same frames from the pet picked in settings
(app/src/game/trayFrames.ts) and sends them to the menu bar, so keep the two in step.
"""
import os
from PIL import Image

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', '..', 'app', 'src-tauri', 'icons')
SHEET = os.path.join(HERE, '..', '..', 'app', 'public', 'assets', 'critters', 'shiba.png')
N = 44                             # icon height in pixels
PET_H = 42                         # the pet's height; two rows stay free for the hop
G = 2                              # pixels per art pixel of the bubble and the "z"s
W, H = 25, 27                      # sprite frame size; rows 4..25 hold the pet
INK = (42, 34, 48, 255)            # the sprite's outline colour
PAPER = (255, 255, 255, 255)

BUBBLE = [
    '.ooooooooo.',
    'opppppppppo',
    'opppppppppo',
    'opppppppppo',
    'opppppppppo',
    'opppppppppo',
    'opppppppppo',
    'opppppppppo',
    'opppppppppo',
    'opppppppppo',
    '.oppoooooo.',
    '.opo.......',
    '.oo........',
]
EXCLAIM = ['..xx.', '..xx.', '..xx.', '..xx.', '.....', '..xx.']
CHECK = ['.....', '....x', '...xx', 'x.xx.', 'xxx..', '.x...']
Z_BIG = ['oooooo', 'oxxxxo', 'oooxoo', 'ooxooo', 'oxxxxo', 'oooooo']
Z_SMALL = ['ooooo', 'oxxoo', 'ooxoo', 'ooxxo', 'ooooo']


def frame(i):
    return Image.open(SHEET).convert('RGBA').crop((i * W, 0, (i + 1) * W, H))


def bounds(frames):
    """box around the opaque pixels of all the frames"""
    boxes = [f.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox() for f in frames]
    return min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)


def draw(im, rows, x0, y0, colours):
    for y, line in enumerate(rows):
        for x, ch in enumerate(line):
            if ch in colours:
                for dy in range(G):
                    for dx in range(G):
                        im.putpixel((x0 + x * G + dx, y0 + y * G + dy), colours[ch])


def grey(im):
    """the faded look for "nothing connected": dark lines stay dark, the rest turns light grey"""
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a:
                l = (r * 30 + g * 59 + b * 11) / 100
                v = 90 if l < 70 else 160 + round(l / 3)
                px[x, y] = (v, v, v, a)


def save(im, name):
    im.save(os.path.join(OUT, f'tray_{name}.png'))


def main():
    front, step_l, step_r = frame(0), frame(1), frame(2)
    x0, y0, x1, y1 = bounds([front, step_l, step_r])
    k = min(2, PET_H / (y1 - y0))      # same as trayFrames.ts: doubled when that fits
    pw, ph = max(1, round((x1 - x0) * k)), max(1, round((y1 - y0) * k))
    n_w = max(N, pw + 14)

    def make(pet, dy=0, extra=None):
        im = Image.new('RGBA', (n_w, N), (0, 0, 0, 0))
        im.alpha_composite(pet.crop((x0, y0, x1, y1)).resize((pw, ph), Image.NEAREST), (0, N - ph + dy * 2))
        if extra:
            extra(im)
        return im

    def bubble(glyph, colour):
        def f(im):
            draw(im, BUBBLE, n_w - 11 * G, 0, {'o': INK, 'p': PAPER})
            draw(im, glyph, n_w - 8 * G, 3 * G, {'x': colour})
        return f

    def zs(im):
        draw(im, Z_BIG, n_w - 6 * G, 0, {'o': INK, 'x': PAPER})
        draw(im, Z_SMALL, n_w - 12 * G, 6 * G, {'o': INK, 'x': PAPER})

    # waddle: left step, hop, right step, hop
    for i, (pet, dy) in enumerate(((step_l, 0), (front, -1), (step_r, 0), (front, -1))):
        save(make(pet, dy), f'run{i}')
    save(make(front, 0, bubble(EXCLAIM, (232, 85, 61, 255))), 'wait')
    save(make(front, 0, bubble(CHECK, (61, 154, 80, 255))), 'done')
    save(make(front, 0, zs), 'idle')
    off = make(front)
    grey(off)
    save(off, 'off')


if __name__ == '__main__':
    main()
