"""Original critter characters (single still images, 1 art pixel = 1 px).

Each critter is one front-facing pose; the app animates it with hops and bobs, the
same way it animates a custom character PNG. Fills only; the dark outline is added
around the silhouette. Run `python3 gen_critters.py` (writes app/public/assets/critters).
"""
import os
from pix import Spr, from_map, hexc

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'public', 'assets', 'critters')
INK = hexc('#3a2e38')

COMMON = {'k': INK, 'e': hexc('#2b2230'), 'h': hexc('#ffffff'), 'p': hexc('#f59fae'), 'n': hexc('#c95f73'), 's': hexc('#f7c9c0')}

def layered(back, front, dx):
    """front map over back map shifted right by dx (same height)"""
    w = max(len(front[0]), dx + len(back[0]))
    out = []
    for b, f in zip(back, front):
        row = list(('.' * dx + b).ljust(w, '.'))
        for x, ch in enumerate(f):
            if ch != '.':
                row[x] = ch
        out.append(''.join(row))
    return out


CHIPMUNK_TAIL = [
    "......TTT..",
    "....TTtttT.",
    "...TttttttT",
    "..TttSSSttT",
    "..TtSttttTT",
    "..TtSttT...",
    "..TtStT....",
    "..TtStT....",
    "...TStT....",
    "...TStT....",
    "...TSttT...",
    "...TSttT...",
    "...TSttT...",
    "...TSttT...",
    "..TStttT...",
    ".TSttttT...",
    "TSttttT....",
    "TSttT......",
    "TTTT.......",
    "...........",
    "...........",
]
CHIPMUNK_BODY = [
    "...............",
    "...............",
    "...OO.....OO...",
    "..OppO...OppD..",
    "..OOOOOOOOOOD..",
    ".OOOOOOOOOOOOD.",
    ".OOOOOOOOOOOOD.",
    "OOheOOOOOOheODD",
    "OOeeOOOOOOeeODD",
    "OOeeOOOOOOeeODD",
    "OWWWWOnnOWWWWDD",
    "WWppWkWWkWppWWD",
    "WWWWWWkkWWWWWWD",
    ".WWWWWWWWWWWWD.",
    ".OWWWccccWWWOD.",
    "OOWWsaaaAsWWOD.",
    ".OWWWsaAsWWWOD.",
    ".OOWWWWWWWWWOD.",
    "..OOWWWWWWWODD.",
    "...DDDDDDDDDD..",
    "....ss....ss...",
]

CRITTERS = {
    # golden hamster with cream cheeks, paws held at the chest
    'hamster': ({
        'O': hexc('#eea95a'), 'D': hexc('#cf8642'), 'W': hexc('#fff3e0'), 'w': hexc('#ead2b4'),
    }, [
        "..OOO............OOO..",
        ".OpppO..........OpppD.",
        ".OppOOOOOOOOOOOOOOppD.",
        "..OOOOOOOOOOOOOOOOOD..",
        ".OOOOOOOOOOOOOOOOOOOD.",
        ".OOOOOOOOOOOOOOOOOOOD.",
        "OOOOheOOOOOOOOOOheOODD",
        "OOOOeeOOOOOOOOOOeeOODD",
        "OOOOeeOOOOOOOOOOeeOODD",
        "OOOWWWWWOOOOOOWWWWWODD",
        "OOWWWWWWWWnnWWWWWWWWOD",
        "OWWppWWWWkWWkWWWWppWWD",
        "OWWWWWWWWWkkWWWWWWWWWD",
        "OWWWWWWWWWWWWWWWWWWWWD",
        ".WWWWWWWssWWssWWWWWWw.",
        ".OWWWWWWssWWssWWWWWwD.",
        "..OWWWWWWWWWWWWWWWwD..",
        "...OOWWWWWWWWWWWWwDD..",
        "....DDDDDDDDDDDDDDD...",
        ".....ss.........ss....",
    ]),
    # white rabbit with long ears and lavender shading
    'rabbit': ({
        'W': hexc('#fffaf6'), 'V': hexc('#ddd3e6'), 'v': hexc('#c3b6d3'),
    }, [
        "....WW........WW....",
        "...WppW......WppV...",
        "...WppW......WppV...",
        "...WppW......WppV...",
        "...WppW......WppV...",
        "...WWWW......WWVV...",
        "..WWWWWWWWWWWWWWWV..",
        ".WWWWWWWWWWWWWWWWWV.",
        ".WWWWWWWWWWWWWWWWWV.",
        "WWWheWWWWWWWWWheWWVV",
        "WWWeeWWWWWWWWWeeWWVV",
        "WWWeeWWWWWWWWWeeWWVV",
        "WWppWWWWWnnWWWWppWVV",
        "WWWWWWWWkWWkWWWWWWVV",
        ".WWWWWWWWkkWWWWWWVV.",
        ".WWWWWWVWWWWVWWWWVV.",
        "..WWWWWVWWWWVWWWVV..",
        "...VWWWWWWWWWWWVVv..",
        "....vvvvvvvvvvvvv...",
    ]),
    # chipmunk with a big striped tail, holding an acorn
    'chipmunk': ({
        'O': hexc('#dd9156'), 'D': hexc('#b56c3d'), 'W': hexc('#fdebd3'),
        'S': hexc('#6e4233'), 'T': hexc('#c97d48'), 't': hexc('#f0b47a'),
        'a': hexc('#d9a35b'), 'A': hexc('#b07a3c'), 'c': hexc('#7b5236'),
    }, layered(CHIPMUNK_TAIL, CHIPMUNK_BODY, 13)),
    # grey tabby kitten with a curled tail
    'kitten': ({
        'O': hexc('#aeb4c8'), 'D': hexc('#8a90a8'), 'S': hexc('#6f7591'), 'W': hexc('#fbf7f4'),
        'w': hexc('#e2dce0'),
    }, [
        "..O.............O.....",
        ".OOO...........OOD....",
        ".OpOO.........OOpD....",
        ".OppOOOSOSOSOOOppD....",
        ".OOOOOOOSOSOOOOOOD....",
        "OOOOOOOOOOOOOOOOOODD..",
        "OOOheOOOOOOOOOheOODD..",
        "OOOeeOOOOOOOOOeeOODD..",
        "OOOeeOOOOOOOOOeeOODD..",
        "OOWWWWWWWnnWWWWWWODD..",
        "OWppWWWWkWWkWWWWppWD..",
        "OWWWWWWWWkkWWWWWWWWD..",
        ".OWWWWWWWWWWWWWWWWD...",
        "..OOWWWWWWWWWWWWDD..O.",
        "..OOOWWWWWWWWWWSDD.OSD",
        ".OOOSWWWWWWWWWWSDD.OD.",
        ".OOOOWWWWWWWWWWODD.OD.",
        ".OOOOWwWWWWWWwWODDOSD.",
        "..OOOWwWWWWWWwWOOOSD..",
        "...DDDWWDDDDWWDDDDD...",
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
