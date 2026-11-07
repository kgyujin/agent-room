// Desktop pets: a see-through strip along the bottom of the screen where each live session's pet
// walks around outside the room. What a pet does follows its session's hook events only
// (deskPlan); the strip lets every click through except on a pet.
// Click a pet: open that session · double-click: show it in the room · drag: pick it up.
import { useEffect, useMemo, useRef, useState } from 'react';
import { backend, IN_TAURI, win } from '../bridge';
import { loadAtlas, type Atlas } from '../game/assets';
import { NAP_AFTER } from '../game/behaviors';
import { DeskWorld, deskMotion, deskPlan, drawTable, TABLE_H, TABLE_W, type DeskPet, type DeskPlan } from '../game/deskPet';
import { loadAllSkins, type Skin } from '../game/skin';
import { sessionNames, stateLabel, stateTone } from '../labels';
import { AgentMark } from '../ui/icons';
import { L } from '../i18n';
import type { Snapshot } from '../types';
import { useLive } from './useLive';

/** with no session the menu bar pet strolls about on its own */
const REST_KEY = '__rest';
const TICK_MS = 1000 / 12;
/** art px above a pet's head for its bubble and hops */
const HEAD_ROOM = 20;

export function Desk() {
  const { list, settings, now } = useLive();
  const [skins, setSkins] = useState<Record<string, Skin>>({});
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [room, setRoom] = useState<Record<string, string>>({});
  const [hover, setHover] = useState<string | null>(null);
  const worldRef = useRef(new DeskWorld());
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const tags = useRef(new Map<string, HTMLDivElement>());
  const pointer = useRef<[number, number] | null>(null);
  const drag = useRef<{ key: string; x0: number; y0: number; dy: number; moved: boolean; id: number } | null>(null);
  const clicks = useRef<{ key: string; at: number; timer: number } | null>(null);
  const dblMs = useRef(500);
  /** what each pet's canvas last showed */
  const drawn = useRef(new Map<string, string>());

  useEffect(() => {
    void loadAtlas('iso').then(setAtlas).catch(() => {});
    void backend.doubleClickMs().then((ms) => (dblMs.current = Math.min(800, Math.max(200, ms)))).catch(() => {});
    void backend.petSkins().then(setRoom).catch(() => {});
    const off = backend.onTrayEvent('pet-skins', (m) => setRoom(m as Record<string, string>));
    return () => void off.then((f) => f());
  }, []);

  const colorsKey = JSON.stringify(settings?.critterColors ?? {});
  // bumped when the room reloads its pictures (a PNG was added, renamed, replaced or removed)
  const [charsVer, setCharsVer] = useState(0);
  useEffect(() => {
    const off = backend.onTrayEvent('characters-changed', () => setCharsVer((v) => v + 1));
    return () => void off.then((f) => f());
  }, []);
  useEffect(() => {
    if (!settings) return;
    void (async () => setSkins(await loadAllSkins(JSON.parse(colorsKey), await backend.listCharacters().catch(() => []))))();
  }, [colorsKey, settings === null, charsVer]);

  const energy = settings?.petEnergy ?? 'normal';
  const scale = Math.min(4, Math.max(2, Math.round(settings?.desktopPetSize ?? 2)));
  const bubbles = settings?.petBubbles ?? true;

  // who is out: the same critters as in the room, wearing the same pets (the room tells which).
  // A session the room has no critter for yet (it waits a few seconds, and has a desk limit) stays in.
  const shown = useMemo(() => list.filter((s) => s.connection !== 'ended' && s.connection !== 'lost' && skins[room[s.key]]), [list, room, skins]);
  const byKey = useMemo(() => Object.fromEntries(shown.map((s) => [s.key, s])), [shown]);
  const names = useMemo(() => sessionNames(shown), [shown]);
  const wear = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of shown) out[s.key] = room[s.key];
    if (!shown.length) out[REST_KEY] = skins[room[REST_KEY]] ? room[REST_KEY] : skins[settings?.trayPet ?? ''] ? settings!.trayPet : 'builtin/shiba';
    return out;
  }, [shown, room, skins, settings?.trayPet]);

  // the plan follows the sessions (and the clock, for "just finished" and dozing off)
  useEffect(() => {
    const w = worldRef.current;
    // the strip's size first, so new pets are spread over the whole screen
    w.width = window.innerWidth;
    w.height = window.innerHeight;
    w.energy = energy;
    w.scale = scale;
    w.half = (Math.max(25, ...Object.values(wear).map((n) => skins[n]?.w ?? 25)) * scale) / 2;
    const plans: [string, DeskPlan][] = shown.length
      ? shown.map((s) => [s.key, deskPlan(s, now, NAP_AFTER[energy])])
      : [[REST_KEY, { act: 'roam', bubble: null, table: false }]];
    w.sync(plans);
  }, [shown, now, energy, scale, wear, skins]);

  // let clicks through everywhere but on a pet (and while one is held)
  const passThrough = useRef(true);
  const setPass = (on: boolean) => {
    if (passThrough.current === on) return;
    passThrough.current = on;
    void win().then((w) => w?.setIgnoreCursorEvents(on));
  };
  const hitTest = (x: number, y: number): string | null => {
    const w = worldRef.current;
    const floor = window.innerHeight;
    for (const p of [...w.pets.values()].reverse()) {
      const sk = skins[wear[p.key]];
      if (!sk) continue;
      const half = (sk.w * scale) / 2 + 3;
      const top = floor - p.lift - (sk.h - (sk.top ?? 0) + 4) * scale;
      if (x >= p.x - half && x <= p.x + half && y >= top && y <= floor - p.lift + 2) return p.key;
    }
    return null;
  };
  const onPointer = (pt: [number, number] | null) => {
    pointer.current = pt;
    if (drag.current) return;
    const k = pt ? hitTest(pt[0], pt[1]) : null;
    worldRef.current.hovered = k;
    setHover(k);
    setPass(k === null);
  };
  const onPointerRef = useRef(onPointer);
  onPointerRef.current = onPointer;
  useEffect(() => {
    // the app reports the pointer (macOS gives an inactive app's windows no hover events)
    if (IN_TAURI) {
      const off = backend.onTrayEvent('hover-desk', (p) => onPointerRef.current((p as [number, number] | null) ?? null));
      return () => void off.then((f) => f());
    }
    const move = (e: MouseEvent) => onPointerRef.current([e.clientX, e.clientY]);
    const out = () => onPointerRef.current(null);
    window.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', out);
    return () => { window.removeEventListener('mousemove', move); document.removeEventListener('mouseleave', out); };
  }, []);

  // new pictures (a PNG changed) are drawn again even where nothing else moved
  useEffect(() => drawn.current.clear(), [skins, atlas]);

  // 12 frames a second, only while the strip is on screen
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const t = performance.now();
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      const w = worldRef.current;
      w.width = window.innerWidth;
      w.height = window.innerHeight;
      const pt = pointer.current;
      w.step(dt, Date.now(), pt ? pt[0] : null);
      for (const p of w.pets.values()) draw(p);
      // a moving pet can walk under (or away from) a still pointer
      if (pt && !drag.current) onPointerRef.current(pt);
    }, TICK_MS);
    return () => clearInterval(id);
  });

  function draw(p: DeskPet) {
    const c = canvases.current.get(p.key);
    const sk = skins[wear[p.key]];
    if (!c || !sk) return;
    const w = worldRef.current;
    const cw = sk.w + 2 * (TABLE_W + 2);
    const ch = sk.h + HEAD_ROOM;
    const walking = w.walking(p);
    const [mx, hop, frame] = deskMotion(p, walking);
    const bubble = Date.now() < p.heartUntil ? 'heart' : p.plan.bubble;
    const table = p.plan.table && !walking && !p.held && p.lift === 0;
    // a pet that looks the same as last tick is left alone: no canvas or style writes, so a quiet
    // strip doesn't make the window server redraw it (Mission Control redraws every window)
    const sig = [wear[p.key], c.width, Math.round(p.x), Math.round(p.lift), mx, hop, frame, p.dir, table ? p.tick : -1, bubbles && bubble, p.plan.act === 'panic', scale, !!atlas].join();
    if (drawn.current.get(p.key) === sig) return;
    drawn.current.set(p.key, sig);
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    c.style.width = `${cw * scale}px`;
    c.style.height = `${ch * scale}px`;
    c.style.transform = `translate(${Math.round(p.x - (cw * scale) / 2)}px, ${Math.round(-p.lift)}px)`;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cw, ch);
    const cx = cw >> 1;
    if (atlas && p.lift === 0) atlas.draw(g, 'shadow', cx - 4, ch - 3);
    const img = frame === 'still' ? sk.canvas : sk.walkF?.[frame === 'walk1' ? 1 : 0] ?? sk.canvas;
    const top = ch - sk.h - hop;
    const right = p.dir === 1; // the art faces left
    g.save();
    if (right) {
      g.translate(cw, 0);
      g.scale(-1, 1);
    }
    g.drawImage(img, cx - (sk.w >> 1) + (right ? -mx : mx), top);
    if (table) {
      // the table stands on the side the pet faces
      g.restore();
      g.save();
      // the same 2px overlap on either side of the pet, so facing left mirrors facing right
      const left = cx - (sk.w >> 1);
      const lx = right ? left + sk.w - 2 : left + 2 - TABLE_W;
      drawTable(g, lx, ch - TABLE_H, p.tick);
    }
    g.restore();
    const head = top + (sk.top ?? 0);
    // the bubble is centred over the head (its tail on the pet's middle column), 1px above it
    if (atlas && bubbles && bubble && !walking) atlas.draw(g, `bubble_${bubble}`, cx - 6, Math.max(0, head - 14));
    // a sweat drop on the back of the head, whichever way the pet faces
    if (atlas && p.plan.act === 'panic') atlas.draw(g, 'sweat', right ? cx - (sk.w >> 1) + 2 : cx + (sk.w >> 1) - 4, head + 2);
    const tag = tags.current.get(p.key);
    if (tag) tag.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(-p.lift - (sk.h - (sk.top ?? 0) + 2) * scale - (bubbles && bubble ? 14 * scale : 0))}px) translate(-50%, -100%)`;
  }

  // ---- click, double-click and drag
  const down = (e: React.PointerEvent) => {
    const k = hitTest(e.clientX, e.clientY);
    if (!k) return;
    const p = worldRef.current.pets.get(k)!;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { key: k, x0: e.clientX, y0: e.clientY, dy: window.innerHeight - p.lift - e.clientY, moved: false, id: e.pointerId };
    setPass(false);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    // kept inside the strip, bubble included
    const sk = skins[wear[d.key]];
    const room = window.innerHeight - ((sk?.h ?? 27) + HEAD_ROOM) * scale;
    worldRef.current.hold(d.key, e.clientX, Math.min(room, window.innerHeight - e.clientY - d.dy));
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      worldRef.current.drop(d.key);
      onPointer([e.clientX, e.clientY]);
      return;
    }
    const p = worldRef.current.pets.get(d.key);
    if (p) p.heartUntil = Date.now() + 1500;
    const c = clicks.current;
    if (c && c.key === d.key && Date.now() - c.at < dblMs.current) {
      clearTimeout(c.timer);
      clicks.current = null;
      if (d.key !== REST_KEY) void backend.trayAction('select', d.key);
      return;
    }
    // wait out the double-click interval before opening the session
    const timer = window.setTimeout(() => {
      clicks.current = null;
      void backend.trayAction(d.key === REST_KEY ? 'open' : 'focus', d.key === REST_KEY ? undefined : d.key);
    }, dblMs.current);
    clicks.current = { key: d.key, at: Date.now(), timer };
  };

  const keys = Object.keys(wear);
  return (
    <div className="desk" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {keys.map((k) => (
        <canvas key={k} className="desk-pet" ref={(el) => { if (el) canvases.current.set(k, el); else canvases.current.delete(k); }} />
      ))}
      {keys.map((k) => {
        const s: Snapshot | undefined = byKey[k];
        const act = worldRef.current.pets.get(k)?.plan.act;
        // a pet that needs the user always says who it is; the others on hover
        const on = hover === k || act === 'call' || act === 'panic';
        return (
          <div key={k} className={`desk-tag ${on ? '' : 'off'}`} ref={(el) => { if (el) tags.current.set(k, el); else tags.current.delete(k); }}>
            <div className={`nametag ${s ? `t-${stateTone(s)}` : ''}`}>
              {s ? <AgentMark agent={s.agent} size={13} /> : null}
              <span>{s ? names[k] : 'Agent Room'}</span>
              <small>{s ? stateLabel(s) : L('쉬는 중', 'Resting')}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
