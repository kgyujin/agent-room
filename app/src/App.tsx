import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backend, checkUpdate, DEFAULT_SETTINGS, IN_TAURI, win, type AppUpdate } from './bridge';
import { runCheck, UpdateDialog, type UpdateState } from './ui/UpdateDialog';
import { loadAtlas } from './game/assets';
import { Sound } from './game/audio';
import { Scene, type Anchor, type Theme } from './game/scene';
import { BUILTIN_CRITTERS, loadBuiltin, loadSkin, skinPrefs, type Skin } from './game/skin';
import type { Overview, Settings, Snapshot, TimelineEntry } from './types';
import { Hud } from './ui/Hud';
import { DetailPanel, type Tab } from './ui/DetailPanel';
import { SessionTabs } from './ui/SessionTabs';
import { SettingsModal } from './ui/SettingsModal';
import { Welcome } from './ui/Welcome';
import { latestLimits, UsageStrip, userTodo } from './ui/Overview';
import { AgentMark, Icon } from './ui/icons';
import { progressOf } from './ui/Hud';
import { AGENT_NAME, doingLabel, justDone, stateTone } from './labels';
import { applyUiTheme, backdropOf, uiTheme } from './themes';
import { keepOnScreen, placeOnScreen, resizeOnScreen, windowRect, type Rect } from './placement';

const PANEL_W = 330;
/** below this window width the side panel would squeeze the room, so it stays closed */
const PANEL_MIN_VW = 900;

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
  // pointer over the window, reported by Rust: an inactive macOS window gets no hover events,
  // so the room-only controls would otherwise only appear after a click
  const [hovered, setHovered] = useState(false);
  // update available on GitHub Releases: checked at launch and every 6 hours when the setting is on,
  // or on demand from the app menu, the menu bar menu and Settings. A found update asks first (dialog);
  // "나중에" leaves a small banner instead of asking again for the same version.
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [updDialog, setUpdDialog] = useState<UpdateState | null>(null);
  const asked = useRef<string | null>(null);
  const checkNow = () => {
    setUpdDialog({ k: 'checking' });
    void runCheck().then((r) => { setUpdDialog(r); if (r.k === 'available') setUpdate(r.u); });
  };
  const checkRef = useRef(checkNow);
  checkRef.current = checkNow;
  const autoUpdate = settings.autoUpdateCheck ?? true;
  useEffect(() => {
    if (!autoUpdate) return;
    const run = () => void checkUpdate().then((u) => {
      setUpdate(u);
      if (u && asked.current !== u.version) {
        asked.current = u.version;
        setUpdDialog((d) => d ?? { k: 'available', u });
      }
    }, () => undefined);
    const first = window.setTimeout(run, 4000);
    const id = window.setInterval(run, 6 * 3600_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [autoUpdate]);
  // office-only view: hides the status dialog, tabs and panel; the office and name tags stay
  const [office, setOffice] = useState(() => { try { return localStorage.getItem('officeView') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('officeView', office ? '1' : '0'); } catch { /* storage unavailable */ } }, [office]);
  const [settingsOpen, setSettingsOpen] = useState<null | 'look' | 'general' | 'agents' | 'dev'>(null);
  const [detailTab, setDetailTab] = useState<Tab>('overview');
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [vw, setVw] = useState(window.innerWidth);
  // the status dialog sits under the room; the room is laid out above it
  const [dockRef, dockH] = useHeight();
  // banners stack above the room so they never cover its wall
  const [bannersRef, bannersH] = useHeight();
  // the toolbar shares the top row with the session tabs
  const [toolbarRef, , toolbarW] = useHeight();
  const [skins, setSkins] = useState<Record<string, Skin>>({});

  const list = useMemo(() => Object.values(sessions).sort((a, b) => priority(a) - priority(b) || b.lastEventAt - a.lastEventAt), [sessions]);
  const realSessions = list.filter((s) => !s.isDemo);
  const selected = (pinned && sessions[pinned]) || list[0] || null;
  const compact = mini || vw < 560;
  // narrow window: the session tabs move under the room
  const tabsBelow = compact && !mini && !office && settings.showTabs && list.length > 0;
  const panelOpen = settings.panelOpen && !mini && !office && vw >= PANEL_MIN_VW && selected !== null;
  // with room to spare the room, the info card and banners stay centred on the whole window when the
  // panel opens (the room does the same in scene.ts), instead of jumping left
  const centred = vw - 2 * PANEL_W >= 740;

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
        await backend.onTrayEvent('select-session', (k) => { setPinned(String(k)); setDetailTab('overview'); }),
        await backend.onTrayEvent('open-settings', (tab) => setSettingsOpen(tab === 'agents' ? 'agents' : 'look')),
        await backend.onTrayEvent('check-update', () => checkRef.current()),
        await backend.onTrayEvent('hover-main', (p) => pointAt.current(Array.isArray(p) ? (p as [number, number]) : null)),
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
      try { sc.zoom = Number(localStorage.getItem('roomZoom')) || 0; } catch { /* storage unavailable */ }
      // browser preview: ?hour=19.5 pins the clock for the sky and lighting
      const pin = new URLSearchParams(location.search).get('hour');
      if (!IN_TAURI && pin !== null) sc.now = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() + Number(pin) * 3600_000); };
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
    // ended sessions leave the office; live ones each get a desk and a critter
    sc.setSessions(list.filter((s) => s.connection !== 'ended' && s.connection !== 'lost'));
  }, [list, ready]);

  // The status card and the banners change height as the agent's work changes (a tool line, a
  // notice, a 4-second error banner). Re-centring the room on every change made the middle of the
  // screen jump, so the room keeps the tallest space they needed until the layout itself changes.
  const tall = useRef({ key: '', dock: 0, banners: 0 });
  const layoutKey = `${vw}x${window.innerHeight}|${panelOpen}|${mini}|${tabsBelow}`;
  if (tall.current.key !== layoutKey) tall.current = { key: layoutKey, dock: 0, banners: 0 };
  const dockRoom = dockH ? (tall.current.dock = Math.max(tall.current.dock, dockH)) : 0;
  const bannersRoom = bannersH ? (tall.current.banners = Math.max(tall.current.banners, bannersH)) : 0;
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.insetRight = panelOpen ? PANEL_W : 0;
    sc.insetBottom = dockRoom ? dockRoom + 24 : tabsBelow ? 36 : 0;
    sc.insetTop = mini ? 0 : bannersRoom ? bannersRoom + 66 : 56;
    sc.resize();
  }, [panelOpen, ready, mini, dockRoom, bannersRoom, tabsBelow]);

  // custom characters (local PNGs) + recoloured built-ins; reloaded when settings open or colours change
  const colorsKey = JSON.stringify(settings.critterColors ?? {});
  const reloadSkins = useCallback(async () => {
    const colors: Record<string, string> = JSON.parse(colorsKey);
    const files = await backend.listCharacters().catch(() => []);
    const loaded = await Promise.all([
      ...BUILTIN_CRITTERS.map(([id]) => loadBuiltin(id, colors[id]).then((sk) => [`builtin/${id}`, sk] as const).catch(() => null)),
      ...files.map((f) => loadSkin(f.bytes).then((sk) => [f.name, sk] as const).catch(() => null)),
    ]);
    setSkins(Object.fromEntries(loaded.filter((x) => x !== null)));
  }, [colorsKey]);
  useEffect(() => { void reloadSkins(); }, [reloadSkins, settingsOpen]);

  // the user's own effect sounds
  const reloadSounds = useCallback(async () => {
    soundRef.current.setCustom(await backend.listSounds().catch(() => []));
  }, []);
  useEffect(() => { void reloadSounds(); }, [reloadSounds]);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.skins = skins;
    sc.prefs = skinPrefs(settings.characters ?? {}, Object.keys(skins).filter((k) => !k.startsWith('builtin/')));
    sc.assignSkins(true);
  }, [settings.characters, skins, ready]);

  useEffect(() => {
    const th = uiTheme(settings.uiTheme);
    applyUiTheme(th);
    document.documentElement.classList.remove('font-mixed', 'font-system', 'font-pixel');
    document.documentElement.classList.add(`font-${settings.font ?? 'mixed'}`);
    sceneRef.current?.setTheme(settings.theme);
    if (sceneRef.current) sceneRef.current.energy = settings.petEnergy ?? 'normal';
    if (sceneRef.current) sceneRef.current.bubbles = settings.petBubbles ?? true;
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
  }, []);

  // always-on-top is kept separately for the normal window and room-only mode
  const onTop = mini ? settings.alwaysOnTopRoom : settings.alwaysOnTop;
  const onTopKey = mini ? 'alwaysOnTopRoom' : 'alwaysOnTop';
  useEffect(() => {
    if (!ready) return;
    win().then((w) => w?.setAlwaysOnTop(onTop));
  }, [ready, onTop]);

  // room-only mode: a borderless transparent window that floats just the room on the desktop.
  // Leaving it puts the window back where it was; inside it the window stays on its screen.
  const windowFrame = useRef<Rect | null>(null);
  // the floating window is cut to the room at a whole pixel scale, so no clear margin is left
  // around it and a room pushed into a screen corner sits right in that corner
  const roomOnlyFit = (scale?: number) => {
    const sc = sceneRef.current;
    return sc ? sc.roomOnlySize(scale ?? sc.roomOnlyScale(440, 360)) : { w: 440, h: 360 };
  };
  const toggleMini = async (force?: boolean) => {
    const next = force ?? !mini;
    if (next === mini) return;
    const w = await win();
    document.documentElement.classList.toggle('room-only', next);
    if (sceneRef.current) sceneRef.current.roomOnly = next;
    setMini(next);
    setHovered(false);
    void backend.setRoomOnly(next);
    if (w) {
      if (await w.isFullscreen()) await w.setFullscreen(false);
      if (next) windowFrame.current = await windowRect();
      await w.setDecorations(!next);
      // macOS: keep the grey title bar hidden (traffic lights float over the app) when decorations return
      if (!next && IS_MAC) await w.setTitleBarStyle('overlay').catch(() => undefined);
      await w.setShadow(!next);
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      await w.setMinSize(next ? new LogicalSize(120, 80) : new LogicalSize(300, 260));
      if (next) {
        const f = roomOnlyFit();
        await resizeOnScreen(f.w, f.h);
      }
      else await placeOnScreen(windowFrame.current ?? { x: 80, y: 80, w: 980, h: 700 });
    }
  };

  // room-only: the controls show while the pointer is over the room itself (or the buttons),
  // not over the clear part of the window
  const pointAt = useRef<(p: [number, number] | null) => void>(() => undefined);
  pointAt.current = (p) => {
    if (!p) return setHovered(false);
    if (!mini) return setHovered(true);
    const t = toolbarRef.current?.getBoundingClientRect();
    const onBar = !!t && p[0] >= t.left - 8 && p[0] <= t.right + 8 && p[1] >= t.top - 8 && p[1] <= t.bottom + 8;
    setHovered(onBar || !!sceneRef.current?.hitRoom(p[0], p[1]));
  };

  // room-only: a window dragged partly off the screen slides back once it is let go
  useEffect(() => {
    if (!mini) return;
    let off: (() => void) | undefined;
    let t = 0;
    void win().then(async (w) => {
      if (!w) return;
      off = await w.onMoved(() => { clearTimeout(t); t = window.setTimeout(() => void keepOnScreen(), 400); });
    });
    return () => { clearTimeout(t); off?.(); };
  }, [mini]);

  // room-only: settings get a window large enough for them, and the room size comes back after
  const beforeSettings = useRef<Rect | null>(null);
  useEffect(() => {
    if (!IN_TAURI) return;
    if (mini && settingsOpen && !beforeSettings.current) {
      void windowRect().then((r) => {
        if (!r) return;
        beforeSettings.current = r;
        void resizeOnScreen(Math.max(r.w, 720), Math.max(r.h, 600));
      });
    } else if (!settingsOpen && beforeSettings.current) {
      const r = beforeSettings.current;
      beforeSettings.current = null;
      if (mini) void placeOnScreen(r);
    } else if (!mini) beforeSettings.current = null;
  }, [settingsOpen, mini]);
  const toggleRef = useRef(toggleMini);
  toggleRef.current = toggleMini;

  // in room-only mode the whole room, pets included, is the drag handle (double-click a pet for its
  // details); in window mode dragging pans the room while it is zoomed in
  /** where the last press started, so the end of a pan is not taken for a click on the floor */
  const downAt = useRef<[number, number]>([0, 0]);
  const onCanvasDown = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (mini) return void (await win())?.startDragging();
    downAt.current = [e.clientX, e.clientY];
    const r = e.currentTarget.getBoundingClientRect();
    if (sceneRef.current?.hitActor(e.clientX - r.left, e.clientY - r.top)) return;
    let last = [e.clientX, e.clientY];
    const move = (ev: MouseEvent) => {
      sceneRef.current?.panBy(ev.clientX - last[0], ev.clientY - last[1]);
      last = [ev.clientX, ev.clientY];
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // mouse wheel / trackpad scroll: zooms the room in window mode, resizes the floating window in room-only mode
  const wheelAcc = useRef(0);
  const onWheel = async (e: React.WheelEvent<HTMLCanvasElement>) => {
    wheelAcc.current += e.deltaY;
    if (Math.abs(wheelAcc.current) < 40) return;
    const dir = wheelAcc.current < 0 ? 1 : -1;
    wheelAcc.current = 0;
    if (!mini) {
      const r = e.currentTarget.getBoundingClientRect();
      const sc = sceneRef.current;
      sc?.zoomAt(dir, e.clientX - r.left, e.clientY - r.top);
      try { localStorage.setItem('roomZoom', String(sc?.zoom ?? 0)); } catch { /* storage unavailable */ }
      return;
    }
    // one whole pixel scale per step; grows from the corner it sits in, so a room in a screen
    // corner stays fully visible
    const sc = sceneRef.current;
    if (!sc || sc.scale + dir < 1) return;
    const f = roomOnlyFit(sc.scale + dir);
    if (f.w <= 1600) await resizeOnScreen(f.w, f.h);
  };

  const petClick = useRef(0);
  // the OS double-click interval: a single click on a pet waits this long so a slow double-click still counts
  const dblMs = useRef(500);
  useEffect(() => { backend.doubleClickMs().then((ms) => { dblMs.current = ms; }).catch(() => {}); }, []);
  const onCanvasDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const hit = sceneRef.current?.hitActor(e.clientX - r.left, e.clientY - r.top);
    if (mini) {
      // room-only: a single click starts dragging the window, so a double-click on a pet opens its app
      if (hit && sessions[hit]) openApp(hit);
      return;
    }
    if (hit) {
      window.clearTimeout(petClick.current);
      if (sessions[hit]) openDetails(hit);
      return;
    }
    sceneRef.current?.resetZoom();
    try { localStorage.setItem('roomZoom', '0'); } catch { /* storage unavailable */ }
  };

  const toggleFullscreen = async () => {
    const w = await win();
    if (w) await w.setFullscreen(!(await w.isFullscreen()));
    else if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  const [furnTip, setFurnTip] = useState<string | null>(null);
  // a short note at the top (e.g. when an agent's app window can't be found)
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);
  /** selects the session and brings the app it runs in (terminal, editor, desktop app) to the front */
  const openApp = (key: string) => {
    setPinned(key);
    if (!IN_TAURI || sessions[key]?.isDemo) return;
    backend.focusAgent(key).catch((e) => setFlash(String(e)));
  };
  const openDetails = (key: string) => {
    setPinned(key);
    setDetailTab('session');
    if (!settings.panelOpen) void saveSettings({ ...settings, panelOpen: true });
    if (mini) void toggleMini(false);
  };
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    soundRef.current.unlock();
    // room-only: a click (or the end of a drag) never pops the window open
    if (mini) return;
    const r = e.currentTarget.getBoundingClientRect();
    const hit = sceneRef.current?.hitActor(e.clientX - r.left, e.clientY - r.top);
    // a pet brings up the app its agent works in; a double-click shows the details instead, so the
    // single click waits a moment (otherwise the other app would already be in front)
    if (hit && sessions[hit]) {
      window.clearTimeout(petClick.current);
      if (e.detail > 1) return; // the second click of a double-click: onCanvasDouble handles it
      setPinned(hit);
      petClick.current = window.setTimeout(() => openApp(hit), dblMs.current);
    } else if (!hit && Math.hypot(e.clientX - downAt.current[0], e.clientY - downAt.current[1]) < 5) {
      // a click on the empty room lets go of the picked pet (back to "자동")
      setPinned(null);
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
    <div className={`app ${compact ? 'mini' : ''} ${mini ? 'room-only' : ''} ${hovered ? 'hovered' : ''} ${IS_MAC && IN_TAURI ? 'mac' : ''} theme-${themeFor(settings.theme)}`} style={mini && !settingsOpen ? undefined : backdropStyle(settings)} onPointerDown={() => soundRef.current.unlock()}
      onMouseMove={mini ? (e) => pointAt.current([e.clientX, e.clientY]) : undefined} onMouseLeave={mini ? () => setHovered(false) : undefined}>
      <canvas ref={canvasRef} className="room" onClick={onCanvasClick} onMouseDown={onCanvasDown} onWheel={onWheel} onDoubleClick={onCanvasDouble}
        title={furnTip ?? undefined} onMouseMove={(e) => {
          // what each piece of furniture is for, as a tooltip
          const r = e.currentTarget.getBoundingClientRect();
          const [x, y] = [e.clientX - r.left, e.clientY - r.top];
          const pet = sceneRef.current?.hitActor(x, y);
          const n = pet ? null : sceneRef.current?.furnitureAt(x, y) ?? null;
          const tip = pet && sessions[pet] ? (mini ? '두 번 눌러서 이 세션 열기' : '눌러서 이 세션 열기 · 두 번 누르면 자세히') : n ? FURN_TIPS[n.replace(/\d+$/, '')] ?? null : null;
          if (tip !== furnTip) setFurnTip(tip);
        }} />
      {/* macOS overlay title bar: drag strip behind the traffic lights (double-click zooms) */}
      {IS_MAC && IN_TAURI && !mini && <div className="titlebar" data-tauri-drag-region />}

      <div className="banners" ref={bannersRef} style={{ right: compact ? 8 : (panelOpen && selected && !centred ? PANEL_W : 0) + 12, left: compact ? 8 : 12 }}>
        {!IN_TAURI && !compact && !office && <div className="banner preview">브라우저 미리보기 · 실제 에이전트와 연결되지 않은 디자인 확인용 화면입니다</div>}
        {(demoRunning || demoShown) && (
          <div className="banner demo">
            {compact ? '데모 · 실제 에이전트 아님' : '데모 모드 · 가상 이벤트를 재생하고 있어요 (실제 에이전트 아님)'}
            {IN_TAURI && <button onClick={toggleDemo}>끄기</button>}
          </div>
        )}
        {update && !updDialog && (
          <div className="banner update">
            {compact ? <>새 버전 {update.version}</> : <>새 버전 {update.version}이 나왔어요</>}
            <button onClick={() => setUpdDialog({ k: 'available', u: update })}>업데이트</button>
          </div>
        )}
        {flash && <div className="banner error">{flash}</div>}
        {serverError && <div className="banner error">이벤트 수신기를 시작하지 못했습니다: {serverError}</div>}
      </div>

      <NameTags scene={sceneRef} sessions={sessions} now={now} selected={selected?.key ?? null} onSelect={openApp} hidden={settings.tagStyle === 'off'} full={settings.tagStyle === 'full'} few={compact && !mini} short={compact} doneSec={settings.doneShownSec ?? 60} idleTags={settings.idleTags ?? 'dim'} />

      {!mini && !office && settings.showTabs && (
        <div className="topleft" style={{ right: (panelOpen && selected ? PANEL_W : 0) + toolbarW + 24 }}>
          <SessionTabs sessions={list} selected={selected?.key ?? null} onSelect={setPinned} pinned={pinned} />
        </div>
      )}
      {/* a small window has no room for the welcome card, so a first-time user still gets one clear next step */}
      {compact && !mini && !selected && (
        <button className="btn primary first-hint" onClick={() => setSettingsOpen('agents')}>에이전트 연결하기</button>
      )}
      {!compact && !office && settings.showDock && (
        <div className="dock" ref={dockRef} style={{ right: panelOpen && selected && !centred ? PANEL_W + 12 : 12 }}>
          {selected ? (
            <Hud s={selected} now={now} limits={settings.showLimits ? latestLimits(list, selected.agent) : null} onOpenApp={IN_TAURI && !selected.isDemo ? () => openApp(selected.key) : undefined} />
          ) : (
            <Welcome detected={detected} onSettings={() => setSettingsOpen('agents')} onDemo={toggleDemo} />
          )}
        </div>
      )}

      {panelOpen && selected && (
        <DetailPanel
          width={PANEL_W}
          s={selected}
          sessions={list}
          onSelect={setPinned}
          showLimits={settings.showLimits}
          timeline={timelines[selected.key] ?? []}
          tab={detailTab}
          setTab={setDetailTab}
          now={now}
          onClose={() => saveSettings({ ...settings, panelOpen: false })}
          onForget={selected.connection === 'ended' || selected.connection === 'lost' ? () => backend.removeSession(selected.key) : undefined}
        />
      )}

      <div className={`toolbar ${office ? 'faded' : ''}`} ref={toolbarRef} style={{ right: panelOpen && selected ? PANEL_W + 12 : 12 }}>
        {/* remaining usage for every agent, at the start of the top-right bar (the tabs make room for it) */}
        {!compact && !office && !mini && settings.showLimits && <UsageStrip sessions={list} now={now} />}
        {!mini && selected && vw >= PANEL_MIN_VW && <ToolBtn icon="panel" label="작업 정보 패널" on={panelOpen} onClick={() => {
          // the office-only view hides the panel, so asking for the panel leaves that view
          if (office) { setOffice(false); if (!settings.panelOpen) void saveSettings({ ...settings, panelOpen: true }); }
          else void saveSettings({ ...settings, panelOpen: !settings.panelOpen });
        }} />}
        {!mini && <ToolBtn icon="eye" label={office ? 'HUD 보이기' : '사무실만 보기'} on={office} onClick={() => setOffice(!office)} />}
        <ToolBtn icon="mini" label={mini ? '창으로 보기' : '룸만 띄우기'} on={mini} onClick={() => toggleMini()} />
        <ToolBtn icon="pin" label="항상 위에 표시" on={onTop} onClick={() => saveSettings({ ...settings, [onTopKey]: !onTop })} />
        {!compact && <ToolBtn icon="full" label="전체 화면" onClick={toggleFullscreen} />}
        <ToolBtn icon={settings.sfx ? 'sound' : 'mute'} label={settings.sfx ? '효과음 끄기' : '효과음 켜기'} on={settings.sfx} onClick={() => saveSettings({ ...settings, sfx: !settings.sfx })} />
        <ToolBtn icon="gear" label="설정" onClick={() => setSettingsOpen('look')} />
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
          characters={Object.keys(skins).filter((k) => !k.startsWith('builtin/'))}
          onCharactersChanged={reloadSkins}
          sound={soundRef.current}
          onSoundsChanged={reloadSounds}
          onCheckUpdate={checkNow}
        />
      )}
      {updDialog && <UpdateDialog state={updDialog} setState={setUpdDialog} onClose={() => setUpdDialog(null)} />}
    </div>
  );
}

function ToolBtn({ icon, label, on, onClick }: { icon: Parameters<typeof Icon>[0]['name']; label: string; on?: boolean; onClick: () => void }) {
  return (
    <button className={`tool ${on ? 'on' : ''}`} onClick={onClick} data-tip={label} aria-label={label}>
      <Icon name={icon} size={16} />
    </button>
  );
}

/** HTML name tags that follow each critter (crisp text over the pixel canvas); click selects the session */
function NameTags({ scene, sessions, now, selected, onSelect, hidden, full, few, short, doneSec, idleTags }: { scene: React.RefObject<Scene | null>; sessions: Record<string, Snapshot>; now: number; selected: string | null; onSelect: (k: string) => void; hidden: boolean; full: boolean; few: boolean; short: boolean; doneSec: number; idleTags: Settings['idleTags'] }) {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
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
      const a = (scene.current?.anchors() ?? []).filter((p) => !fewRef.current || p.key === selRef.current || needsYou(sessRef.current[p.key]));
      // nudge tags up so neighbours never cover each other (compact tags are ~40 x 22 css px)
      // the selected tag and tags waiting on the user also show the project name, so they are about as wide as a full tag
      const w = (p: Anchor) => tagWidth(sessRef.current[p.key], fullRef.current || p.key === selRef.current, shortRef.current);
      const placed: Anchor[] = [];
      for (const p of [...a].sort((u, v) => v.y - u.y)) {
        while (placed.some((q) => Math.abs(q.x - p.x) < (w(p) + w(q)) / 2 && Math.abs(q.y - p.y) < 22)) p.y -= 22;
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
    <div className="nametags">
      {anchors.map((a) => {
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
          <button key={a.key} className={`nametag t-${tone} ${selected === a.key ? 'on' : ''} ${urgent ? 'urgent' : ''} ${resting && idleTags === 'dim' ? 'settled' : ''}`} style={{ left: a.x, top: a.y }} onClick={() => onSelect(a.key)} title={`${AGENT_NAME[s.agent]} · ${s.project ?? ''}${doingLabel(s) ? `\n${doingLabel(s)}` : ''}${s.isDemo ? '' : '\n눌러서 이 세션 열기'}`}>
            <AgentMark agent={s.isDemo ? 'demo' : s.agent} />
            {(full || selected === a.key) && <b className="tag-project">{s.project ?? AGENT_NAME[s.agent]}</b>}
            {doing ? <span>{doing}</span> : urgent && <span>{s.project ?? AGENT_NAME[s.agent]}</span>}
            <i className={`dot tone-${tone}`} />
            {prog && (full || selected === a.key) && <small>{prog.done}/{prog.total}</small>}
          </button>
        );
      })}
    </div>
  );
}

/** height of a name tag in CSS px (it is drawn above its anchor point) */
const TAG_H = 22;
const tagLabel = (s: Snapshot, short: boolean) => (short ? doingLabel(s)?.split(' · ')[0] ?? null : doingLabel(s));

/** rough CSS width of a name tag, so neighbours can be moved apart before they are drawn */
function tagWidth(s: Snapshot | undefined, withProject: boolean, short: boolean): number {
  if (!s) return 40;
  const doing = tagLabel(s, short) ?? (needsYou(s) ? s.project ?? '' : '');
  const text = (withProject ? (s.project ?? AGENT_NAME[s.agent]).slice(0, 12) + ' ' : '') + doing;
  let w = 40;
  for (const ch of text) w += ch.charCodeAt(0) > 255 ? 11 : 6.5;
  return Math.min(w, 260);
}

/** what the furniture is for (hover tooltip); keys are sprite names without their number */
const FURN_TIPS: Record<string, string> = {
  desk: '작업 책상 · 생각하거나 코드를 고칠 때 앉아서 종이에 적어요. 종이에 지금 상태가 그려져요',
  stool: '작업 책상 의자',
  rig: '테스트 장치 · 테스트나 명령을 실행할 때 여기서 작동시켜요. 불빛이 통과(초록)·실패(빨강)를 보여줘요',
  shelf: '책장 · 파일이나 자료를 찾을 때 와요',
  board: '게시판 · 작업 계획(할 일 목록)을 세울 때 와요',
  sofa: '소파 · 일이 끝나면 쉬는 곳',
  beanbag: '빈백 · 쉬는 자리',
  coffee: '커피 카트 · 쉬는 동안 들러요',
  table: '찻상',
};

const IS_MAC = /Mac/.test(navigator.userAgent);

/** the session is waiting on the user (approval, answer, or an error to look at) */
const needsYou = (s: Snapshot | undefined) => !!s && userTodo(s, 0) !== null;

/** soft radial backdrop around the room (window mode); the canvas leaves it clear */
function backdropStyle(s: Settings): React.CSSProperties {
  const [a, b] = backdropOf(s.backdrop, uiTheme(s.uiTheme));
  return { background: `radial-gradient(ellipse 75% 70% at 45% 45%, ${a}, ${b})` };
}

/** [ref, offsetHeight, offsetWidth] of the referenced element, kept current with a ResizeObserver (0 when unmounted) */
function useHeight(): [React.RefObject<HTMLDivElement | null>, number, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return setSize((p) => (p[0] || p[1] ? [0, 0] : p));
    const ro = new ResizeObserver(() => setSize((p) => (p[0] === el.offsetHeight && p[1] === el.offsetWidth ? p : [el.offsetHeight, el.offsetWidth])));
    ro.observe(el);
    return () => ro.disconnect();
  });
  return [ref, size[0], size[1]];
}
