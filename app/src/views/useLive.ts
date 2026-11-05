// Live session list + 1 s clock for the small windows (menu bar popover, island).
import { useEffect, useMemo, useState } from 'react';
import { backend } from '../bridge';
import type { Settings, Snapshot } from '../types';
import { applyUiTheme, uiTheme } from '../themes';
import { useAccountLimits } from '../ui/Overview';

const RANK: Record<Snapshot['state'], number> = { waiting: 0, error: 1, starting: 2, planning: 2, reading: 2, editing: 2, running: 2, testing: 2, completed: 3, idle: 4, disconnected: 5 };

/** sessions asking the user: the longest-waiting first; everything else: the newest first */
function byAsk(a: Snapshot, b: Snapshot): number {
  const ask = (s: Snapshot) => s.waiting?.since ?? (s.state === 'error' ? s.error?.at ?? s.lastEventAt : null);
  const x = ask(a), y = ask(b);
  return x !== null && y !== null ? x - y : b.lastEventAt - a.lastEventAt;
}

export function useLive() {
  useAccountLimits();
  const [sessions, setSessions] = useState<Record<string, Snapshot>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [now, setNow] = useState(Date.now());
  // running agent processes; an agent that has not done anything since the app started has no session yet
  const [running, setRunning] = useState(0);
  useEffect(() => {
    const unsub: (() => void)[] = [];
    (async () => {
      const [ov, st] = await Promise.all([backend.overview(), backend.getSettings()]);
      setSessions(Object.fromEntries(ov.sessions.map((s) => [s.key, s])));
      setRunning(ov.detected.claude + ov.detected.codex);
      unsub.push(await backend.onDetected((d) => setRunning(d.claude + d.codex)));
      const apply = (s: Settings) => {
        setSettings(s);
        applyUiTheme(uiTheme(s.uiTheme));
        const cl = document.documentElement.classList;
        [...cl].filter((c) => c.startsWith('font-')).forEach((c) => cl.remove(c));
        cl.add(`font-${s.font ?? 'mixed'}`);
      };
      apply(st);
      unsub.push(await backend.onTrayEvent('settings-changed', (s) => apply(s as Settings)));
      unsub.push(
        await backend.onUpdate((u) =>
          setSessions((prev) => {
            const next = { ...prev };
            if (u.removed) delete next[u.snapshot.key];
            else next[u.snapshot.key] = u.snapshot;
            return next;
          }),
        ),
      );
    })();
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { unsub.forEach((u) => u()); clearInterval(id); };
  }, []);
  const list = useMemo(
    () => Object.values(sessions)
      .filter((s) => s.connection !== 'ended' && s.connection !== 'lost')
      .sort((a, b) => RANK[a.state] - RANK[b.state] || byAsk(a, b)),
    [sessions],
  );
  return { list, settings, now, running };
}
