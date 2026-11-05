// Keeps the main window fully on its screen when it changes size. The room-only window
// usually lives in a screen corner, so it grows and shrinks from the corner it is
// nearest to instead of from its top-left, and never ends up partly off the screen.
import { win } from './bridge';

export interface Rect { x: number; y: number; w: number; h: number }

/** current outer frame of the window in logical px */
export async function windowRect(): Promise<Rect | null> {
  const w = await win();
  if (!w) return null;
  const k = await w.scaleFactor();
  const p = (await w.outerPosition()).toLogical(k);
  const s = (await w.outerSize()).toLogical(k);
  return { x: p.x, y: p.y, w: s.width, h: s.height };
}

async function workArea(): Promise<Rect | null> {
  const { currentMonitor } = await import('@tauri-apps/api/window');
  const m = await currentMonitor();
  if (!m) return null;
  const p = m.workArea.position.toLogical(m.scaleFactor);
  const s = m.workArea.size.toLogical(m.scaleFactor);
  return { x: p.x, y: p.y, w: s.width, h: s.height };
}

/** Moves `r` inside `area` (as far as it fits). */
export function clampRect(r: Rect, area: Rect): Rect {
  const w = Math.min(r.w, area.w);
  const h = Math.min(r.h, area.h);
  return {
    w, h,
    x: Math.round(Math.min(Math.max(r.x, area.x), area.x + area.w - w)),
    y: Math.round(Math.min(Math.max(r.y, area.y), area.y + area.h - h)),
  };
}

/**
 * New frame for a window of size w x h that grows from the corner of `cur` nearest the screen
 * corner (a window on the right keeps its right edge, one at the bottom its bottom edge).
 */
export function resizeFromCorner(cur: Rect, w: number, h: number, area: Rect): Rect {
  const right = cur.x + cur.w / 2 > area.x + area.w / 2;
  const bottom = cur.y + cur.h / 2 > area.y + area.h / 2;
  return clampRect({ x: right ? cur.x + cur.w - w : cur.x, y: bottom ? cur.y + cur.h - h : cur.y, w, h }, area);
}

/** Applies a frame (outer size) to the window. */
async function apply(r: Rect) {
  const w = await win();
  if (!w) return;
  const { LogicalPosition, LogicalSize } = await import('@tauri-apps/api/dpi');
  await w.setSize(new LogicalSize(r.w, r.h));
  await w.setPosition(new LogicalPosition(r.x, r.y));
}

/** Resizes the window to w x h from its nearest screen corner, kept on the screen. */
export async function resizeOnScreen(w: number, h: number) {
  const [cur, area] = await Promise.all([windowRect(), workArea()]);
  if (!cur) return;
  await apply(area ? resizeFromCorner(cur, w, h, area) : { ...cur, w, h });
}

/** Puts the window at `r` (e.g. where it was before room-only mode), kept on the screen. */
export async function placeOnScreen(r: Rect) {
  const area = await workArea();
  await apply(area ? clampRect(r, area) : r);
}

/** Pulls the window back inside the screen if part of it was dragged off. */
export async function keepOnScreen() {
  const [cur, area] = await Promise.all([windowRect(), workArea()]);
  if (!cur || !area) return;
  const r = clampRect(cur, area);
  if (r.x !== Math.round(cur.x) || r.y !== Math.round(cur.y)) await apply({ ...r, w: cur.w, h: cur.h });
}
