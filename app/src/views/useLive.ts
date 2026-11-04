// Live session list + 1 s clock for the small windows (menu bar popover, island).
import { useEffect, useMemo, useState } from 'react';
import { backend } from '../bridge';
import type { Settings, Snapshot } from '../types';
import { applyUiTheme, uiTheme } from '../themes';

const RANK: Record<Snapshot['state'], number> = { waiting: 0, error: 1, starting: 2, planning: 2, reading: 2, editing: 2, running: 2, testing: 2, completed: 3, idle: 4, disconnected: 5 };

export function useLive() {
  const [sessions, setSessions] = useState<Record<string, Snapshot>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const unsub: (() => void)[] = [];
    (async () => {
      const [ov, st] = await Promise.all([backend.overview(), backend.getSettings()]);
      setSessions(Object.fromEntries(ov.sessions.map((s) => [s.key, s])));
      setSettings(st);
      applyUiTheme(uiTheme(st.uiTheme));
      document.documentElement.classList.add(`font-${st.font ?? 'mixed'}`);
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
      .sort((a, b) => RANK[a.state] - RANK[b.state] || b.lastEventAt - a.lastEventAt),
    [sessions],
  );
  return { list, settings, now };
}
