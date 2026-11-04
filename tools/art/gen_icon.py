"""App icon + tray icon (pixel art, generated)."""
import os
from PIL import Image
from pix import Spr, Iso, hexc, shade

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'src-tauri', 'icons')


def house(size=32):
    s = Spr(32, 32)
    iso = Iso(16, 7)
    pink, cream, wood = hexc('#f7a8bf'), hexc('#fbe9df'), hexc('#a8693f')
    grass = hexc('#8ccf7e')
    iso.box(s, -1, -1, -3, 8, 8, 3, grass, shade(grass, 0.85), shade(grass, 0.7))
    iso.box(s, 0, 0, 0, 6, 6, 7, cream, hexc('#f4d9cf'), hexc('#e6b8ad'))
    # roof
    for i in range(4):
        iso.box(s, -0.5, -0.5 + i * 0.9, 7 + i, 7, 7 - i * 1.8, 1, pink, pink, shade(pink, 0.8), rim=False)
    # window + door
    p = iso.p(6, 2.5, 4); s.rect(p[0] + 1, p[1] - 1, 2, 2, hexc('#ffe7a3'))
    p = iso.p(3, 6, 0); s.rect(p[0] - 1, p[1] - 4, 2, 4, wood)
    s.outline(color=hexc('#3a2832'))
    return s


def main():
    os.makedirs(OUT, exist_ok=True)
    h = house()
    big = h.im.resize((1024, 1024), Image.NEAREST)
    bg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    # rounded-square pastel sky tile
    from PIL import ImageDraw
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((64, 64, 960, 960), radius=200, fill=(191, 230, 240, 255))
    d.rounded_rectangle((64, 600, 960, 960), radius=200, fill=(253, 227, 236, 255))
    d.rectangle((64, 600, 960, 760), fill=(253, 227, 236, 255))
    inner = h.im.resize((832, 832), Image.NEAREST)
    bg.alpha_composite(inner, (96, 80))
    bg.save(os.path.join(OUT, 'source.png'))
    h.im.resize((64, 64), Image.NEAREST).save(os.path.join(OUT, 'tray.png'))
    print('icons written')


if __name__ == '__main__':
    main()
