// HTML name tags over the pixel room: crisp text that follows each pet, crowded tags bundled.
import { useEffect, useRef, useState } from 'react';
import type { Anchor, Scene } from '../game/scene';
import type { Settings, Snapshot } from '../types';
import { AGENT_NAME, doingLabel, justDone, stateTone } from '../labels';
import { AgentMark } from './icons';
import { progressOf } from './Hud';
import { userTodo } from './Overview';
import { L } from '../i18n';

/** HTML name tags that follow each critter (crisp text over the pixel canvas); click selects the session */
export function NameTags({ scene, sessions, now, selected, onSelect, hidden, full, hover, onHover, pixel, few, short, doneSec, idleTags }: { scene: React.RefObject<Scene | null>; sessions: Record<string, Snapshot>; now: number; selected: string | null; onSelect: (k: string) => void; hidden: boolean; full: boolean; hover: string | null; onHover: (k: string | null) => void; pixel: boolean; few: boolean; short: boolean; doneSec: number; idleTags: Settings['idleTags'] }) {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  // 'hover' tags: null = every tag; otherwise only the pointed pet's (plus the picked and waiting ones)
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  // hidden resting tags are left out before tags are bundled, so a bundle only counts tags it can show
  const hideRef = useRef({ idleTags, doneSec });
  hideRef.current = { idleTags, doneSec };
  // a bundle of crowded tags that was opened: its keys, until the timer closes it again
  const [opened, setOpened] = useState<string[]>([]);
  const openedRef = useRef(opened);
  openedRef.current = opened;
  useEffect(() => {
    if (!opened.length) return;
    const id = window.setTimeout(() => setOpened([]), 15_000);
    return () => window.clearTimeout(id);
  }, [opened]);
  const fullRef = useRef(full);
  fullRef.current = full;
  const selRef = useRef(selected);
  selRef.current = selected;
  const sessRef = useRef(sessions);
  sessRef.current = sessions;
  // narrow windows: only the tags that matter (selected, or waiting on the user), so the small room is not buried
  const fewRef = useRef(few);
  fewRef.current = few;
  // small windows: just what the pet is doing ("코드 수정 중"), without the file or command
  const shortRef = useRef(short);
  shortRef.current = short;
  useEffect(() => {
    let last = '';
    const loop = () => {
      const keep = (p: Anchor) => p.key === selRef.current || needsYou(sessRef.current[p.key]);
      const hv = hoverRef.current;
      const hiddenRest = (p: Anchor) => {
        const s = sessRef.current[p.key];
        if (!s || hideRef.current.idleTags !== 'hide' || p.key === selRef.current) return false;
        const settled = s.state === 'completed' && !justDone(s, Date.now(), hideRef.current.doneSec);
        return settled || (s.state === 'idle' && s.connection === 'live');
      };
      let a = (scene.current?.anchors() ?? []).filter((p) => !hiddenRest(p) && (keep(p) || (!fewRef.current && (hv === null || p.key === hv))));
      // nudge tags up so neighbours never cover each other (compact tags are ~40 x 22 css px)
      // the selected tag and tags waiting on the user also show the project name, so they are about as wide as a full tag
      const w = (p: Anchor) => (p.key.startsWith(GROUP) ? 46 : tagWidth(sessRef.current[p.key], fullRef.current ? 'full' : p.key === selRef.current ? 'sel' : 'min', shortRef.current));
      // three or more tags crowded together become one bundle tag ("펫 3"), opened by a click;
      // the picked and waiting pets always keep their own tag
      const near = (p: Anchor, q: Anchor) => Math.abs(q.x - p.x) < (w(p) + w(q)) / 2 && Math.abs(q.y - p.y) < TAG_H * 1.5;
      const loose = a.filter((p) => !keep(p) && !openedRef.current.includes(p.key));
      const groups: Anchor[][] = [];
      for (const p of loose) {
        const hit = groups.filter((g) => g.some((q) => near(p, q)));
        const merged = [p, ...hit.flat()];
        for (const g of hit) groups.splice(groups.indexOf(g), 1);
        groups.push(merged);
      }
      for (const g of groups.filter((g) => g.length >= 3)) {
        a = a.filter((p) => !g.includes(p));
        a.push({ key: GROUP + g.map((p) => p.key).sort().join(','), agent: '', x: g.reduce((t, p) => t + p.x, 0) / g.length, y: Math.min(...g.map((p) => p.y)) });
      }
      const placed: Anchor[] = [];
      for (const p of [...a].sort((u, v) => v.y - u.y)) {
        while (placed.some((q) => Math.abs(q.x - p.x) < (w(p) + w(q)) / 2 && Math.abs(q.y - p.y) < TAG_H)) p.y -= TAG_H;
        placed.push(p);
      }
      // keep every tag inside the window: one pushed past the top edge comes back down (it may then overlap
      // a neighbour, which is better than being cut off), and one near a side edge slides inward
      const vw = window.innerWidth;
      for (const p of a) {
        p.y = Math.max(p.y, TAG_H + 2);
        const half = w(p) / 2;
        p.x = Math.min(Math.max(p.x, half + 2), vw - half - 2);
      }
      const sig = selRef.current + '|' + a.map((p) => `${p.key}:${Math.round(p.x)}:${Math.round(p.y)}`).join('|');
      if (sig !== last) {
        last = sig;
        setAnchors(a);
      }
    };
    // the room only redraws at 12 fps, so following it faster is wasted work
    const id = window.setInterval(() => !document.hidden && loop(), 1000 / 12);
    return () => window.clearInterval(id);
  }, [scene]);
  if (hidden) return null;
  return (
    <div className={`nametags ${pixel ? 'pixel' : ''}`}>
      {anchors.map((a) => {
        if (a.key.startsWith(GROUP)) {
          const keys = a.key.slice(GROUP.length).split(',');
          return (
            <button key={a.key} className="nametag group" style={{ left: Math.round(a.x), top: Math.round(a.y) }} onClick={() => setOpened(keys)} title={keys.map((k) => sessions[k]?.project ?? '').join('\n') + '\n' + L('눌러서 펼치기', 'Click to expand')}>
              <span>{L('펫', 'Pets')} {keys.length}</span>
            </button>
          );
        }
        const s = sessions[a.key];
        if (!s) return null;
        const prog = progressOf(s);
        // a turn finished a while ago reads as idle: no "완료" any more, and the tag steps back
        const settled = s.state === 'completed' && !justDone(s, now, doneSec);
        const resting = settled || (s.state === 'idle' && s.connection === 'live');
        // the setting can hide resting pets' tags (the selected one stays)
        if (resting && idleTags === 'hide' && selected !== a.key) return null;
        const tone = settled ? 'calm' : stateTone(s);
        const urgent = needsYou(s);
        const doing = settled ? null : tagLabel(s, short);
        return (
          <button key={a.key} className={`nametag t-${tone} ${selected === a.key ? 'on' : ''} ${urgent ? 'urgent' : ''} ${resting && idleTags === 'dim' ? 'settled' : ''}`} style={{ left: Math.round(a.x), top: Math.round(a.y) }} onClick={() => onSelect(a.key)} onMouseEnter={() => onHover(a.key)} onMouseLeave={() => onHover(null)} title={`${AGENT_NAME[s.agent]} · ${s.project ?? ''}${doingLabel(s) ? `\n${doingLabel(s)}` : ''}${s.isDemo ? '' : '\n' + L('눌러서 이 세션 열기', 'Click to open this session')}`}>
            <AgentMark agent={s.isDemo ? 'demo' : s.agent} />
            {/* which pet is which: a short project name by default (so tags stay small and don't cover other pets);
                the picked pet gets its whole name, and only full tags add what it does (the bar at the bottom says it) */}
            {full ? (
              <>
                <b className="tag-project">{tagName(s)}</b>
                {doing && <span>{doing}</span>}
              </>
            ) : (
              <span>{tagName(s, selected === a.key ? 20 : 12)}</span>
            )}
            <i className={`dot tone-${tone}`} />
            {prog && full && <small>{prog.done}/{prog.total}</small>}
          </button>
        );
      })}
    </div>
  );
}

/** height of a name tag in CSS px (it is drawn above its anchor point) */
const TAG_H = 22;
/** key prefix of a bundle of crowded tags */
const GROUP = 'group:';
const tagLabel = (s: Snapshot, short: boolean) => (short ? doingLabel(s)?.split(' · ')[0] ?? null : doingLabel(s));
/** project name on a tag; a long one keeps its start and ends in "…" (a cut in the middle, "api-…ver", was hard to read) */
const tagName = (s: Snapshot, max = 16) => {
  const ch = [...(s.project ?? AGENT_NAME[s.agent])];
  return ch.length <= max ? ch.join('') : ch.slice(0, max - 1).join('') + '…';
};

/** rough CSS width of a name tag, so neighbours can be moved apart before they are drawn */
function tagWidth(s: Snapshot | undefined, mode: 'full' | 'sel' | 'min', short: boolean): number {
  if (!s) return 34;
  const text = mode === 'full' ? `${tagName(s)} ${tagLabel(s, short) ?? ''}` : tagName(s, mode === 'sel' ? 20 : 12);
  const big = mode !== 'min';
  let w = big ? 44 : 40;
  for (const ch of text) w += ch.charCodeAt(0) > 255 ? (big ? 13 : 12.5) : big ? 8 : 7.4;
  return Math.min(w, 260);
}

/** the session is waiting on the user (approval, answer, or an error to look at) */
const needsYou = (s: Snapshot | undefined) => !!s && userTodo(s, 0) !== null;
