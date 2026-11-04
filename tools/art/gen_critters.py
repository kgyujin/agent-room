"""Original critter characters (single still images, 1 art pixel = 1 px).

Each critter is one front-facing pose; the app animates it with hops and bobs, the
same way it animates a custom character PNG. Fills only; the dark outline is added
around the silhouette. Run `python3 gen_critters.py` (writes app/public/assets/critters).
"""
import os
from pix import Spr, from_map, hexc

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'public', 'assets', 'critters')
INK = hexc('#3b2a2a')

COMMON = {'k': hexc('#2b1f22'), 'e': hexc('#2b2230'), 'h': hexc('#ffffff'), 'p': hexc('#f59fae'), 'n': hexc('#c95f73'), 's': hexc('#f7c9c0')}

CRITTERS = {
    # golden hamster: white face and belly, golden back showing at the sides
    'hamster': ({'G': hexc('#f0b765'), 'g': hexc('#d99a4e'), 'W': hexc('#fffaf2')}, [
        "..GG.......GG..",
        ".GgGGGGGGGGGgG.",
        ".GGGGGWWWGGGGG.",
        "GGGWWWWWWWWWGGG",
        "GGWWWWWWWWWWWGG",
        "GGWWkWWWWWkWWGG",
        "GGWWkWWnWWkWWGg",
        "GGWpWWWWWWWpWGg",
        "GGWWWWWWWWWWWGg",
        ".GWWWWWWWWWWWg.",
        "WGWWWWWWWWWWWgW",
        ".GGWWWWWWWWWgg.",
        "..gGGGGGGGGGg..",
        "...gg.....gg...",
    ]),
    # white rabbit with tall ears
    'rabbit': ({'W': hexc('#fffaf6'), 'V': hexc('#e3d9ec')}, [
        "...WW.....WW...",
        "..WppW...WppV..",
        "..WppW...WppV..",
        "..WppW...WppV..",
        "..WWWWWWWWWWV..",
        ".WWWWWWWWWWWWV.",
        "WWWWWWWWWWWWWVV",
        "WWWWkWWWWWkWWVV",
        "WWWWkWWnWWkWWVV",
        "WWWpWWWWWWWpWVV",
        ".WWWWWWWWWWWWV.",
        "WWWWWWWWWWWWVVW",
        ".WWWWWWWWWWWVV.",
        "..VVVVVVVVVVV..",
        "...VV.....VV...",
    ]),
    # grey tabby kitten with a tail flicking up on the right
    'kitten': ({'G': hexc('#a7aec4'), 'g': hexc('#868da6'), 'W': hexc('#fffaf6'), 'V': hexc('#e6e0e8')}, [
        ".G.........G.....",
        ".GG.......GG.....",
        ".GpGGGgGGGpG.....",
        "GGGGGGgGGGGGG....",
        "GGGWWWWWWWWGGG...",
        "GGWWWWWWWWWWGG...",
        "GWWWkWWWWWkWWG...",
        "GWWWkWWnWWkWWG.G.",
        "GWWpWWWWWWWpWG.Gg",
        ".WWWWWWWWWWWWV.Gg",
        "WWWWWWWWWWWWVVWGg",
        ".WWWWWWWWWWWVVGg.",
        "..GVVVVVVVVVGGg..",
        "...GG.....GG.....",
    ]),
    # round yellow chick with a little tuft
    'chick': ({'Y': hexc('#ffe27a'), 'y': hexc('#f4c64f'), 'o': hexc('#f29a4a')}, [
        ".......Y.......",
        "......YY.......",
        "....YYYYYYY....",
        "..YYYYYYYYYYY..",
        ".YYYYYYYYYYYYy.",
        ".YYYkYYYYYkYYy.",
        "YYYYkYYooYkYYyy",
        "YYYpYYYooYYpYyy",
        "yYYYYYYYYYYYYyy",
        "YyYYYYYYYYYYyYy",
        ".yYYYYYYYYYYyy.",
        "..yyYYYYYYyyy..",
        "....yyyyyyy....",
        "....oo...oo....",
    ]),
}


def build(name):
    pal, rows = CRITTERS[name]
    assert len({len(r) for r in rows}) == 1, name
    art = from_map(rows, {**COMMON, **pal})
    s = Spr(art.w + 2, art.h + 2)  # 1px margin for the outline
    s.paste(art, 1, 1)
    return s.outline(color=INK)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in CRITTERS:
        s = build(name)
        s.im.save(os.path.join(OUT, f'{name}.png'))
    print('critters written:', ', '.join(CRITTERS))


if __name__ == '__main__':
    main()
