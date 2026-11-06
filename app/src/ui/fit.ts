// Keeps a box from scrolling: drops items from its end, group by group, until the rest fits.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * After a render that changed its content, and on resize, hides (class `fit-off`) items of `ref`
 * until it no longer overflows. Groups are CSS selectors tried in order; inside a group the last item goes first,
 * taken in turn from each column (`.dmap-col`, `.dboard-col`) so no column empties while another
 * is full, the last column first on a tie. Returns how many items were hidden.
 */
export function useFit(ref: RefObject<HTMLElement | null>, groups: string[]): number {
  const [cut, setCut] = useState(0);
  // what the last fit saw: the number of elements, the length of the text and how many it hid. The
  // page re-renders every second (clocks), and refitting each time forced dozens of layouts a second
  // for nothing; a fit is redone only when one of these changed (or the box resized, below)
  const seen = useRef('');
  const fitRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sig = () => `${el.getElementsByTagName('*').length}|${el.textContent?.length ?? 0}|${el.getElementsByClassName('fit-off').length}`;
    const fit = () => {
      el.querySelectorAll('.fit-off').forEach((x) => x.classList.remove('fit-off'));
      el.querySelectorAll<HTMLElement>('.fit-spread').forEach((x) => { x.classList.remove('fit-spread'); x.style.removeProperty('--fit-extra'); });
      let n = 0;
      let rows: Element[][] = [];
      for (const sel of groups) {
        const cols = new Map<Element, Element[]>();
        for (const x of el.querySelectorAll(sel)) {
          const c = x.closest('.dmap-col, .dboard-col') ?? el;
          cols.set(c, [...(cols.get(c) ?? []), x]);
        }
        let dropped = false;
        while (el.scrollHeight > el.clientHeight + 1) {
          // on a tie the later column gives first, so the first one (내 차례 on the board) stays longest
          const longest = [...cols.values()].reduce((a, c) => (c.length >= a.length ? c : a), [] as Element[]);
          const x = longest.pop();
          if (!x) break;
          x.classList.add('fit-off');
          n++;
          dropped = true;
        }
        if (dropped) rows = [...cols.values()];
      }
      // rows were dropped: share the space left (less than one row) out between the rows that stayed,
      // so the cell doesn't end in an empty band
      const k = Math.max(0, ...rows.map((c) => c.length));
      if (k > 1) {
        const top = el.getBoundingClientRect().top;
        const bottom = Math.max(...[...el.children].map((c) => c.getBoundingClientRect().bottom));
        const rowH = rows.flat().reduce((a, x) => a + x.getBoundingClientRect().height, 0) / rows.flat().length;
        // the gaps go between rows, so the last row of each column stays on the bottom edge; table
        // rows instead all grow a little (a gap would only fatten one row)
        const table = rows[0]?.[0]?.tagName === 'TR';
        const spread = (table ? rows.flat() : rows.flatMap((c) => c.slice(0, -1))) as HTMLElement[];
        spread.forEach((x) => x.classList.add('fit-spread'));
        // rows don't always grow by exactly the extra (table cells round), so step down until it fits;
        // never trade the fit for the spacing
        for (let extra = Math.min(Math.round(rowH), Math.floor((el.clientHeight - (bottom - top)) / (table ? k : k - 1))); ; extra -= 2) {
          spread.forEach((x) => x.style.setProperty('--fit-extra', `${Math.max(0, extra)}px`));
          if (extra <= 0 || el.scrollHeight <= el.clientHeight + 1) break;
        }
      }
      setCut(n);
      seen.current = sig();
    };
    fitRef.current = fit;
    if (sig() !== seen.current) fit();
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cut;
}
