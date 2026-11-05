"""Small pixel-art toolkit used by gen_art.py (PIL only, no AI, deterministic)."""
from PIL import Image


def hexc(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def shade(c, f):
    """Darken (f<1) or lighten (f>1) an RGBA colour, with a slight warm hue shift on darks."""
    r, g, b, a = c
    if f < 1:
        return (int(r * f), int(g * f * 0.96), int(b * f * 1.02 if b * f * 1.02 < 255 else 255), a)
    return (min(255, int(r + (255 - r) * (f - 1))), min(255, int(g + (255 - g) * (f - 1))),
            min(255, int(b + (255 - b) * (f - 1))), a)


class Spr:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        self.px = self.im.load()

    def put(self, x, y, c):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h and c is not None:
            if c[3] == 255:
                self.px[x, y] = c
            else:  # alpha blend over existing
                r, g, b, a = self.px[x, y]
                t = c[3] / 255
                if a == 0:
                    self.px[x, y] = c
                else:
                    self.px[x, y] = (int(r + (c[0] - r) * t), int(g + (c[1] - g) * t), int(b + (c[2] - b) * t), max(a, c[3]))

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[x, y]
        return (0, 0, 0, 0)

    def rect(self, x, y, w, h, c):
        x, y = int(round(x)), int(round(y))
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, c)

    def poly(self, pts, c, mask=None):
        """Scanline fill using pixel-centre rule (no ties on 2:1 iso edges). Returns filled pixel set."""
        filled = set()
        ys = [p[1] for p in pts]
        n = len(pts)
        for py in range(int(min(ys)) - 1, int(max(ys)) + 1):
            cy = py + 0.5
            xs = []
            for i in range(n):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % n]
                if (y1 <= cy < y2) or (y2 <= cy < y1):
                    xs.append(x1 + (cy - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                xa, xb = xs[i], xs[i + 1]
                for px in range(int(xa - 1), int(xb + 1)):
                    if xa <= px + 0.5 < xb:
                        if mask is None or (px, py) in mask:
                            self.put(px, py, c(px, py) if callable(c) else c)
                            filled.add((px, py))
        return filled

    def paste(self, other, x, y):
        for yy in range(other.h):
            for xx in range(other.w):
                c = other.px[xx, yy]
                if c[3]:
                    self.put(x + xx, y + yy, c)

    def outline(self, color=None, factor=0.45, diag=False):
        """Selective outline: transparent pixels touching filled ones get a darkened neighbour colour."""
        add = {}
        nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diag:
            nb += [(1, 1), (-1, -1), (1, -1), (-1, 1)]
        for y in range(self.h):
            for x in range(self.w):
                if self.px[x, y][3]:
                    continue
                for dx, dy in nb:
                    c = self.get(x + dx, y + dy)
                    if c[3] == 255:
                        add[(x, y)] = color or shade(c, factor)
                        break
        for (x, y), c in add.items():
            self.px[x, y] = c
        return self

    def bbox(self):
        return self.im.getbbox()

    def crop(self):
        bb = self.im.getbbox()
        out = Spr(bb[2] - bb[0], bb[3] - bb[1])
        out.im = self.im.crop(bb)
        out.px = out.im.load()
        return out, bb[0], bb[1]

    def flip(self):
        out = Spr(self.w, self.h)
        out.im = self.im.transpose(Image.FLIP_LEFT_RIGHT)
        out.px = out.im.load()
        return out


def from_map(rows, pal):
    """rows: list of equal-length strings; '.' transparent; others looked up in pal."""
    h = len(rows)
    w = max(len(r) for r in rows)
    s = Spr(w, h)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != '.' and ch != ' ':
                s.put(x, y, pal[ch])
    return s
