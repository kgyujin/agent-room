import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backend, DEFAULT_SETTINGS, IN_TAURI, win } from './bridge';
import { loadAtlas } from './game/assets';
import { Sound } from './game/audio';
import { Scene, type Theme } from './game/scene';
import { loadSkin, type Skin } from './game/skin';
import type { Overview, Settings, Snapshot, TimelineEntry } from './types';
import { Hud, MiniPill } from './ui/Hud';
import { DetailPanel } from './ui/DetailPanel';
import { SessionTabs } from './ui/SessionTabs';
import { SettingsModal } from './ui/SettingsModal';
import { Icon } from './ui/icons';
import { AGENT_NAME } from './labels';

const PANEL_W = 330;

function priority(s: Snapshot): number {
  if (s.connection === 'ended' || s.connection === 'lost') return 9;
  return { waiting: 0, error: 1, starting: 2, planning: 2, reading: 2, editing: 2, running: 2, testing: 2, completed: 3, idle: 4, disconnected: 5 }[s.state];
}

function themeFor(t: Settings['theme']): Theme {
  if (t !== 'auto') return t;
  const h = new Date().getHours();
  return h >= 6 && h < 16 ? 'day' : h >= 16 && h < 19 ? 'sunset' : 'night';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const soundRef = useRef(new Sound());
  const [sessions, setSessions] = useState<Record<string, Snapshot>>({});
  const [timelines, setTimelines] = useState<Record<string, TimelineEntry[]>>({});
  const [detected, setDetected] = useState<Overview['detected']>({ claude: 0, codex: 0 });
  const [serverError, setServerError] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mini, setMini] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<null | 'general' | 'agents' | 'dev'>(null);
  const [detailTab, setDetailTab] = useState<'timeline' | 'tasks' | 'session'>('timeline');
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [vw, setVw] = useState(window.innerWidth);
  const [skins, setSkins] = useState<Record<string, Skin>>({});

  const list = useMemo(() => Object.values(sessions).sort((a, b) => priority(a) - priority(b) || b.lastEventAt - a.lastEventAt), [sessions]);
  const realSessions = list.filter((s) => !s.isDemo);
  const selected = (pinned && sessions[pinned]) || list[0] || null;
  const compact = mini || vw < 560;
  const panelOpen = settings.panelOpen && !mini && vw >= 720;

  // ---------------------------------------------------------------- data
  useEffect(() => {
    let unsub: (() => void)[] = [];
    (async () => {
      const [ov, st] = await Promise.all([backend.overview(), backend.getSettings()]);
      setSessions(Object.fromEntries(ov.sessions.map((s) => [s.key, s])));
      setDetected(ov.detected);
      setServerError(ov.serverError);
      setDemoRunning(ov.demoRunning);
      setSettings(st);
      unsub.push(
        await backend.onUpdate((u) => {
          setSessions((prev) => {
            const next = { ...prev };
            const old = prev[u.snapshot.key];
            if (u.removed) delete next[u.snapshot.key];
            else next[u.snapshot.key] = u.snapshot;
            if (!u.removed && old && old.state !== u.snapshot.state) cue(old, u.snapshot);
            return next;
          });
          if (u.appended.length) {
            setTimelines((prev) => (prev[u.snapshot.key] ? { ...prev, [u.snapshot.key]: [...prev[u.snapshot.key], ...u.appended].slice(-300) } : prev));
          }
          if (u.snapshot.isDemo && u.removed) setDemoRunning(false);
        }),
        await backend.onDetected(setDetected),
        await backend.onTrayEvent('set-mini', () => void toggleRef.current(true)),
        await backend.onTrayEvent('select-session', (k) => setPinned(String(k))),
      );
    })();
    return () => unsub.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cue = (old: Snapshot, s: Snapshot) => {
    const snd = soundRef.current;
    if (s.state === 'waiting') snd.play('alert');
    else if (s.state === 'completed') snd.play('done');
    else if (s.state === 'error' && (s.error?.fatal || s.lastTest?.ok === false)) snd.play('error');
    else if (s.state === 'starting' && old.state !== 'starting') snd.play('start');
  };

  // load timeline for the selected session when the panel needs it
  useEffect(() => {
    if (!selected || !panelOpen || timelines[selected.key]) return;
    backend.timeline(selected.key).then((t) => setTimelines((p) => ({ ...p, [selected.key]: t })));
  }, [selected?.key, panelOpen, timelines]);

  // ---------------------------------------------------------------- scene
  useEffect(() => {
    let disposed = false;
    loadAtlas().then((atlas) => {
      if (disposed || !canvasRef.current) return;
      const sc = new Scene(canvasRef.current, atlas);
      sceneRef.current = sc;
      sc.start();
      setReady(true);
    });
    const onResize = () => {
      setVw(window.innerWidth);
      sceneRef.current?.resize();
    };
    window.addEventListener('resize', onResize);
    const onVis = () => sceneRef.current?.setFps(document.hidden ? 0 : document.hasFocus() ? 12 : 6);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    window.addEventListener('blur', onVis);
    return () => {
      disposed = true;
      sceneRef.current?.stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.removeEventListener('blur', onVis);
    };
  }, []);

  // pause rendering when the native window is minimized/hidden (Tauri)
  useEffect(() => {
    if (!IN_TAURI) return;
    const id = window.setInterval(async () => {
      const w = await win();
      if (!w || !sceneRef.current) return;
      const [vis, min] = await Promise.all([w.isVisible(), w.isMinimized()]);
      if (!vis || min) sceneRef.current.setFps(0);
      else if (!document.hidden) sceneRef.current.setFps(document.hasFocus() ? 12 : 6);
    }, 1500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.setView({ session: selected, empty: list.length === 0 });
  }, [selected, list.length, ready]);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.insetRight = panelOpen ? PANEL_W : 0;
    sc.insetBottom = 0;
    sc.resize();
  }, [panelOpen, ready, mini]);

  // custom characters (local PNGs); reloaded each time the settings window opens
  const reloadSkins = useCallback(async () => {
    const files = await backend.listCharacters().catch(() => []);
    const loaded = await Promise.all(files.map((f) => loadSkin(f.bytes).then((sk) => [f.name, sk] as const).catch(() => null)));
    setSkins(Object.fromEntries(loaded.filter((x) => x !== null)));
  }, []);
  useEffect(() => { void reloadSkins(); }, [reloadSkins, settingsOpen]);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.skins = Object.fromEntries(
      Object.entries(settings.characters ?? {}).flatMap(([agent, name]) => (skins[name] ? [[agent, skins[name]]] : [])),
    );
  }, [settings.characters, skins, ready]);

  useEffect(() => {
    sceneRef.current?.setTheme(themeFor(settings.theme));
    const snd = soundRef.current;
    snd.sfxOn = settings.sfx;
    snd.setBgm(settings.bgm);
  }, [settings, ready]);

  // 1 s clock for elapsed time (only while visible)
  useEffect(() => {
    const id = window.setInterval(() => !document.hidden && setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ---------------------------------------------------------------- actions
  const saveSettings = useCallback(async (s: Settings) => {
    setSettings(s);
    await backend.saveSettings(s);
    const w = await win();
    if (w) await w.setAlwaysOnTop(s.alwaysOnTop);
  }, []);

  useEffect(() => {
    if (!ready) return;
    win().then((w) => w?.setAlwaysOnTop(settings.alwaysOnTop));
  }, [ready]); // apply saved always-on-top once

  // room-only mode: a borderless transparent window that floats just the room on the desktop
  const windowSize = useRef<[number, number]>([980, 700]);
  const toggleMini = async (force?: boolean) => {
    const next = force ?? !mini;
    if (next === mini) return;
    const w = await win();
    document.documentElement.classList.toggle('room-only', next);
    if (sceneRef.current) sceneRef.current.roomOnly = next;
    setMini(next);
    if (w) {
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      if (await w.isFullscreen()) await w.setFullscreen(false);
      if (next) {
        const sz = (await w.innerSize()).toLogical(await w.scaleFactor());
        windowSize.current = [sz.width, sz.height];
      }
      await w.setDecorations(!next);
      await w.setShadow(!next);
      await w.setSize(next ? new LogicalSize(440, 360) : new LogicalSize(...windowSize.current));
    }
  };
  const toggleRef = useRef(toggleMini);
  toggleRef.current = toggleMini;

  // in room-only mode the room itself is the drag handle (except the character, which opens details)
  const onCanvasDown = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!mini || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (sceneRef.current?.hitActor(e.clientX - r.left, e.clientY - r.top)) return;
    (await win())?.startDragging();
  };

  const toggleFullscreen = async () => {
    const w = await win();
    if (w) await w.setFullscreen(!(await w.isFullscreen()));
    else if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    soundRef.current.unlock();
    const r = e.currentTarget.getBoundingClientRect();
    if (sceneRef.current?.hitActor(e.clientX - r.left, e.clientY - r.top) && selected) {
      setDetailTab('session');
      if (!settings.panelOpen) void saveSettings({ ...settings, panelOpen: true });
      if (mini) void toggleMini(false);
    }
  };

  const toggleDemo = async () => {
    if (demoRunning) {
      await backend.demoStop();
      setDemoRunning(false);
    } else {
      await backend.demoStart();
      setDemoRunning(true);
    }
  };

  const demoShown = selected?.isDemo ?? false;

  return (
    <div className={`app ${compact ? 'mini' : ''} ${mini ? 'room-only' : ''} theme-${themeFor(settings.theme)}`} onPointerDown={() => soundRef.current.unlock()}>
      <canvas ref={canvasRef} className="room" onClick={onCanvasClick} onMouseDown={onCanvasDown} />

      {!IN_TAURI && !compact && <div className="banner preview">브라우저 미리보기 · 실제 Agent와 연결되지 않은 디자인 확인용 화면입니다</div>}
      {(demoRunning || demoShown) && (
        <div className="banner demo">
          데모 모드 · 가상 이벤트를 재생하고 있어요 (실제 Agent 아님)
          {IN_TAURI && <button onClick={toggleDemo}>끄기</button>}
        </div>
      )}
      {serverError && <div className="banner error">이벤트 수신기를 시작하지 못했습니다: {serverError}</div>}

      {!compact && (
        <div className="topleft">
          <SessionTabs sessions={list} selected={selected?.key ?? null} onSelect={setPinned} pinned={pinned} />
          {selected ? (
            <Hud s={selected} now={now} showTokens={settings.showTokens} />
          ) : (
            <EmptyCard detected={detected} onSetup={() => setSettingsOpen('agents')} onDemo={toggleDemo} />
          )}
        </div>
      )}

      {compact && <MiniPill s={selected} now={now} onExpand={mini ? () => toggleMini(false) : undefined} />}

      {panelOpen && selected && (
        <DetailPanel
          width={PANEL_W}
          s={selected}
          timeline={timelines[selected.key] ?? []}
          tab={detailTab}
          setTab={setDetailTab}
          now={now}
          onClose={() => saveSettings({ ...settings, panelOpen: false })}
          onForget={selected.connection === 'ended' || selected.connection === 'lost' ? () => backend.removeSession(selected.key) : undefined}
        />
      )}

      <div className="toolbar" style={{ right: panelOpen && selected ? PANEL_W + 12 : 12 }}>
        {!mini && vw >= 720 && <ToolBtn icon="panel" label="작업 정보 패널" on={settings.panelOpen} onClick={() => saveSettings({ ...settings, panelOpen: !settings.panelOpen })} />}
        <ToolBtn icon="mini" label={mini ? '창으로 보기' : '룸만 띄우기'} on={mini} onClick={() => toggleMini()} />
        <ToolBtn icon="pin" label="항상 위에 표시" on={settings.alwaysOnTop} onClick={() => saveSettings({ ...settings, alwaysOnTop: !settings.alwaysOnTop })} />
        {!compact && <ToolBtn icon="full" label="전체 화면" onClick={toggleFullscreen} />}
        <ToolBtn icon="sound" label={settings.sfx ? '효과음 끄기' : '효과음 켜기'} on={settings.sfx} onClick={() => saveSettings({ ...settings, sfx: !settings.sfx })} />
        <ToolBtn icon="gear" label="설정" onClick={() => setSettingsOpen('general')} />
      </div>

      {settingsOpen && (
        <SettingsModal
          initialTab={settingsOpen}
          settings={settings}
          onChange={saveSettings}
          onClose={() => setSettingsOpen(null)}
          demoRunning={demoRunning}
          onToggleDemo={toggleDemo}
          realCount={realSessions.length}
          characters={Object.keys(skins)}
        />
      )}
    </div>
  );
}

function ToolBtn({ icon, label, on, onClick }: { icon: Parameters<typeof Icon>[0]['name']; label: string; on?: boolean; onClick: () => void }) {
  return (
    <button className={`tool ${on ? 'on' : ''}`} onClick={onClick} title={label} aria-label={label}>
      <Icon name={icon} size={12} />
    </button>
  );
}

function EmptyCard({ detected, onSetup, onDemo }: { detected: Overview['detected']; onSetup: () => void; onDemo: () => void }) {
  const running = [detected.claude ? `${AGENT_NAME.claude} ${detected.claude}개` : '', detected.codex ? `${AGENT_NAME.codex} ${detected.codex}개` : ''].filter(Boolean).join(', ');
  return (
    <div className="card hud empty">
      <div className="hud-title">연결된 Agent 없음</div>
      <p className="muted">
        {running
          ? `실행 중인 ${running} 프로세스가 보여요. 다음 Hook 이벤트가 들어오면 방에 나타납니다. 계속 안 보이면 Hook 설치 상태를 확인하세요.`
          : 'Claude Code나 Codex가 작업을 시작하면 자동으로 연결돼요. 처음이라면 Hook을 먼저 설치해 주세요.'}
      </p>
      <div className="row">
        <button className="btn primary" onClick={onSetup}>Agent 연동 설정</button>
        {IN_TAURI && <button className="btn" onClick={onDemo}>데모 보기</button>}
      </div>
    </div>
  );
}
