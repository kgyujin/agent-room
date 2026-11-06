// Keeps a box from scrolling: drops items from its end, group by group, until the rest fits.
import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * After every render and on resize, hides (class `fit-off`) items of `ref` until it no longer
 * overflows. Groups are CSS selectors tried in order; inside a group the last item goes first,
 * taken in turn from each column (`.dmap-col`, `.dboard-col`) so no column empties while another
 * is full, the last column first on a tie. Returns how many items were hidden.
 */
export function useFit(ref: RefObject<HTMLElement | null>, groups: string[]): number {
  const [cut, setCut] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.querySelectorAll('.fit-off').forEach((x) => x.classList.remove('fit-off'));
      let n = 0;
      for (const sel of groups) {
        const cols = new Map<Element, Element[]>();
        for (const x of el.querySelectorAll(sel)) {
          const c = x.closest('.dmap-col, .dboard-col') ?? el;
          cols.set(c, [...(cols.get(c) ?? []), x]);
        }
        while (el.scrollHeight > el.clientHeight + 1) {
          // on a tie the later column gives first, so the first one (내 차례 on the board) stays longest
          const longest = [...cols.values()].reduce((a, c) => (c.length >= a.length ? c : a), [] as Element[]);
          const x = longest.pop();
          if (!x) break;
          x.classList.add('fit-off');
          n++;
        }
      }
      setCut(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return cut;
}
