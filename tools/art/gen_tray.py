"""Menu bar icon frames (run `python3 gen_tray.py`): the shiba from the app icon, in colour, telling the state at a glance.

- run0..run3: the shiba waddles while agents work (the app plays them faster the more agents work)
- wait: a "!" bubble when an agent waits for the user
- done: a check bubble when work just finished
- idle: "z"s when nothing is going on
- off: a faded grey shiba when no agent is connected

36x36 colour images (not templates). macOS draws the menu bar icon 18pt tall, so on a Retina screen
each art pixel of the 25x27 pet sprite is exactly one screen pixel. One colour per pixel.
These are the bundled defaults; the app draws the same frames from the pet picked in settings
(app/src/game/trayFrames.ts) and sends them to the menu bar, so keep the two in step.
"""
import os
from PIL import Image

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', '..', 'app', 'src-tauri', 'icons')
SHEET = os.path.join(HERE, '..', '..', 'app', 'public', 'assets', 'critters', 'shiba.png')
N = 36
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


def canvas():
    return Image.new('RGBA', (N, N), (0, 0, 0, 0))


def put_pet(im, pet, dy=0):
    im.alpha_composite(pet, (0, N - 26 + dy))   # feet on the bottom row


def draw(im, rows, x0, y0, colours):
    for y, line in enumerate(rows):
        for x, ch in enumerate(line):
            if ch in colours:
                im.putpixel((x0 + x, y0 + y), colours[ch])


def bubble(im, glyph, colour):
    draw(im, BUBBLE, N - 11, 0, {'o': INK, 'p': PAPER})
    draw(im, glyph, N - 8, 3, {'x': colour})


def save(im, name):
    im.save(os.path.join(OUT, f'tray_{name}.png'))


def main():
    front, step_l, step_r = frame(0), frame(1), frame(2)
    # waddle: left step, hop, right step, hop
    for i, (pet, dy) in enumerate(((step_l, 0), (front, -1), (step_r, 0), (front, -1))):
        im = canvas()
        put_pet(im, pet, dy)
        save(im, f'run{i}')

    im = canvas()
    put_pet(im, front)
    bubble(im, EXCLAIM, (232, 85, 61, 255))
    save(im, 'wait')

    im = canvas()
    put_pet(im, front)
    bubble(im, CHECK, (61, 154, 80, 255))
    save(im, 'done')

    im = canvas()
    put_pet(im, front)
    draw(im, Z_BIG, N - 6, 0, {'o': INK, 'x': PAPER})
    draw(im, Z_SMALL, N - 12, 6, {'o': INK, 'x': PAPER})
    save(im, 'idle')

    # off: the shiba in faded greys
    im = canvas()
    pet = front.copy()
    for y in range(H):
        for x in range(W):
            p = pet.getpixel((x, y))
            if p[3]:
                v = 90 if p == INK else 160 + (p[0] * 30 + p[1] * 59 + p[2] * 11) // 300
                pet.putpixel((x, y), (v, v, v, 255))
    put_pet(im, pet)
    save(im, 'off')


if __name__ == '__main__':
    main()
