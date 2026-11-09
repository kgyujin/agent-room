// A window that moves to another display (the island, the desktop pets) fades out, moves while it
// can't be seen, takes its new size without animating, and fades back in. The app sends
// `leaving` before it moves the window and `arrived` after; a move without a `leaving` first
// (a display plugged in or out, a changed setting) still fades in instead of morphing.
import { useEffect, useRef, useState } from 'react';
import { backend } from '../bridge';

type MoveEvent = 'island-leaving' | 'island-screen' | 'desk-leaving' | 'desk-screen';

/** class names for the window's root: `away` hides it, `moving` turns its size animation off */
export function useScreenMove(leaving: MoveEvent, arrived: MoveEvent, onArrive?: () => Promise<unknown> | void): string {
  const [away, setAway] = useState(false);
  const [moving, setMoving] = useState(false);
  const cb = useRef(onArrive);
  cb.current = onArrive;
  useEffect(() => {
    let alive = true;
    let fallback = 0;
    let settle = 0;
    const arrive = async () => {
      clearTimeout(fallback);
      clearTimeout(settle);
      setMoving(true);
      setAway(true);
      await cb.current?.();
      // two frames: the new size is drawn while still hidden, then it fades in
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!alive) return;
        setAway(false);
        settle = window.setTimeout(() => setMoving(false), 300);
      }));
    };
    const leave = () => {
      clearTimeout(settle);
      setMoving(true);
      setAway(true);
      // the window may already be there (nothing to move, so no `arrived`): come back anyway
      fallback = window.setTimeout(() => void arrive(), 800);
    };
    const offs = [backend.onTrayEvent(leaving, leave), backend.onTrayEvent(arrived, () => void arrive())];
    return () => {
      alive = false;
      clearTimeout(fallback);
      clearTimeout(settle);
      for (const off of offs) void off.then((f) => f());
    };
  }, [leaving, arrived]);
  return `${moving ? 'moving' : ''} ${away ? 'away' : ''}`;
}
