import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backend, checkUpdate, DEFAULT_SETTINGS, IN_TAURI, win, ZOOMS, type AppUpdate } from './bridge';
import { runCheck, UpdateDialog, type UpdateState } from './ui/UpdateDialog';
import { loadAtlas } from './game/assets';
import { Sound } from './game/audio';
import { Scene, type Theme } from './game/scene';
import { BUILTIN_CRITTERS, loadBuiltin, loadSkin, petPool, type Skin } from './game/skin';
import { trayFrames } from './game/trayFrames';
import { addToDay, daySummary, type DayLog } from './report';
import type { Overview, Settings, Snapshot, TimelineEntry } from './types';
import { Hud } from './ui/Hud';
import { NameTags } from './ui/NameTags';
import { DetailPanel, type Tab } from './ui/DetailPanel';
import { DashboardPage } from './ui/DashboardPage';
import { SessionTabs, StatusPills } from './ui/SessionTabs';
import { SettingsModal } from './ui/SettingsModal';
import { Welcome } from './ui/Welcome';
import { UsageStrip, useAccountLimits, userTodo } from './ui/Overview';
import { Icon } from './ui/icons';
import { fmtAgo, setTokenUnit } from './labels';
import { applyUiTheme, backdropOf, uiTheme } from './themes';
import { isEn, L, setLang } from './i18n';
import { keepOnScreen, placeOnScreen, resizeOnScreen, windowRect, type Rect } from './placement';

const PANEL_W = 330;
/** below this window width the side panel would squeeze the room, so it stays closed */
const PANEL_MIN_VW = 900;
/** room-only window width limits for resizing it with the scroll wheel (CSS px) */
const ROOM_ONLY_MIN_W = 300;
const ROOM_ONLY_MAX_W = 1200;
/** how long a new session must last before its critter comes in */
const NEW_SESSION_MS = 3000;

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
  useAccountLimits();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const soundRef = useRef(new Sound());
  const [sessions, setSessions] = useState<Record<string, Snapshot>>({});
  const [timelines, setTimelines] = useState<Record<string, TimelineEntry[]>>({});
  // today's entries of every session, for the day summary (see DayLog)
  const [day, setDay] = useState<DayLog | null>(null);
  const [detected, setDetected] = useState<Overview['detected']>({ claude: 0, codex: 0 });
  const [serverError, setServerError] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  setTokenUnit(settings.tokenUnit); // read by fmtTokens while this render runs
  // quiet hours need local time; this changes at a daylight saving switch, and the effect sends it again
  const tzOff = -new Date().getTimezoneOffset();
  useEffect(() => void backend.setTzOffset(tzOff), [tzOff]);
  setLang(settings.language); // read by L() while this render runs
  const en = isEn();
  useEffect(() => void backend.setUiLang(en), [en]);
  const [mini, setMini] = useState(false);
  // pointer over the window, reported by Rust: an inactive macOS window gets no hover events,
  // so the room-only controls would otherwise only appear after a click
  const [hovered, setHovered] = useState(false);
  // update available on GitHub Releases: checked once at launch when the setting is on,
  // or on demand from the app menu, the menu bar menu and Settings. A found update asks first (dialog);
  // "나중에" leaves a small banner instead of asking again for the same version.
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [updDialog, setUpdDialog] = useState<UpdateState | null>(null);
  const asked = useRef<string | null>(null);
  const checkNow = () => {
    // an install already running keeps its dialog; a second check would offer another install
    if (updDialog?.k === 'installing' || updDialog?.k === 'checking') return;
    setUpdDialog({ k: 'checking' });
    void runCheck().then((r) => { setUpdDialog(r); if (r.k === 'available') setUpdate(r.u); });
  };
  const checkRef = useRef(checkNow);
  checkRef.current = checkNow;
  // ⌘+ / ⌘− / ⌘0 (보기 menu on macOS, keys elsewhere): the whole window's contents in steps
  const zoom = settings.uiZoom ?? 1;
  useEffect(() => {
    if (!IN_TAURI) return;
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => getCurrentWebview().setZoom(zoom)).catch(() => undefined);
  }, [zoom]);
  const zoomRef = useRef((_: string) => {});
  zoomRef.current = (how: string) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    const next = how === 'reset' ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + (how === 'in' ? 1 : -1)))];
    if (next !== zoom) void saveSettings({ ...settings, uiZoom: next });
  };
  useEffect(() => {
    if (IS_MAC) return; // the 보기 menu's shortcuts handle these on macOS
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const how = e.key === '=' || e.key === '+' ? 'in' : e.key === '-' ? 'out' : e.key === '0' ? 'reset' : null;
      if (how) { e.preventDefault(); zoomRef.current(how); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
    const first = window.setTimeout(run, 2000);
    return () => clearTimeout(first);
  }, [autoUpdate]);
  // office-only view: hides the status dialog, tabs and panel; the office and name tags stay
  const [office, setOffice] = useState(() => { try { return localStorage.getItem('officeView') === '1'; } catch { return false; } });
  // the welcome card stays closed once the user closes it (settings > 에이전트 has the same steps)
  const [welcomeClosed, setWelcomeClosed] = useState(() => { try { return localStorage.getItem('welcomeClosed') === '1'; } catch { return false; } });
  const closeWelcome = () => { setWelcomeClosed(true); try { localStorage.setItem('welcomeClosed', '1'); } catch { /* storage unavailable */ } };
  useEffect(() => { try { localStorage.setItem('officeView', office ? '1' : '0'); } catch { /* storage unavailable */ } }, [office]);
  // dashboard views: beside the room ('split') or filling the window ('full'), any window size
  const [dashView, setDashView] = useState<'off' | 'split' | 'full'>(() => {
    try { const v = localStorage.getItem('dashView'); return v === '1' || v === 'full' ? 'full' : v === 'split' ? 'split' : 'off'; } catch { return 'off'; }
  });
  useEffect(() => { try { localStorage.setItem('dashView', dashView); } catch { /* storage unavailable */ } }, [dashView]);
  // open: the pane to show ('last' = the one used last time)
  const [settingsOpen, setSettingsOpen] = useState<null | 'last' | 'agents'>(null);
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
  // the split dashboard takes the panel's place (wider), leaving the room at least 480px on the left
  const dashSplit = dashView === 'split' && !mini && !office && vw >= PANEL_MIN_VW;
  const dashPage = (dashView === 'full' || (dashView === 'split' && !dashSplit && !office)) && !mini;
  const panelOpen = dashSplit || (settings.panelOpen && !mini && !office && vw >= PANEL_MIN_VW);
  const panelW = dashSplit ? Math.max(480, Math.min(Math.round(vw * 0.55), vw - 480)) : PANEL_W;

  // ---------------------------------------------------------------- data
  useEffect(() => {
    let unsub: (() => void)[] = [];
    (async () => {
      const [ov, st] = await Promise.all([backend.overview(), backend.getSettings()]);
      setSessions(Object.fromEntries(ov.sessions.map((s) => [s.key, s])));
      // what the sessions already did today, before this window started listening
      for (const s of ov.sessions) void backend.timeline(s.key).then((tl) => setDay((d) => addToDay(d, s, tl, Date.now())), () => {});
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
            setDay((d) => addToDay(d, u.snapshot, u.appended, Date.now()));
            setTimelines((prev) => (prev[u.snapshot.key] ? { ...prev, [u.snapshot.key]: [...prev[u.snapshot.key], ...u.appended].slice(-300) } : prev));
          }
          if (u.snapshot.isDemo && u.removed) setDemoRunning(false);
        }),
        await backend.onDetected(setDetected),
        await backend.onTrayEvent('set-mini', () => void toggleRef.current(true)),
        await backend.onTrayEvent('select-session', (k) => { setPinned(String(k)); setDetailTab('overview'); }),
        await backend.onTrayEvent('open-settings', (tab) => setSettingsOpen(tab === 'agents' ? 'agents' : 'last')),
        await backend.onTrayEvent('check-update', () => checkRef.current()),
        await backend.onTrayEvent('open-dashboard', () => { setOffice(false); void toggleRef.current(false); setDashView(window.innerWidth >= PANEL_MIN_VW ? 'split' : 'full'); }),
        await backend.onTrayEvent('ui-zoom', (how) => zoomRef.current(String(how))),
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
  const asking = useRef(new Set<string>());
  useEffect(() => {
    const page = dashPage || dashSplit;
    if (!panelOpen && !page) return;
    // the dashboards' activity log needs every session's log; the tabbed panel only the selected one
    const keys = page ? list.map((x) => x.key) : selected ? [selected.key] : [];
    for (const k of keys.filter((k) => !timelines[k] && !asking.current.has(k))) {
      asking.current.add(k);
      backend.timeline(k).then((t) => setTimelines((p) => (p[k] ? p : { ...p, [k]: t }))).finally(() => asking.current.delete(k));
    }
  }, [selected?.key, panelOpen, dashPage, dashSplit, mini, list, timelines]);

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

  // ended sessions leave the office; live ones each get a desk and a critter. A session gets its
  // critter only after a few seconds: a session that ends right away (a one-shot run an editor
  // button starts, for example) would otherwise pop in and vanish.
  const inRoom = list.filter((s) => s.connection !== 'ended' && s.connection !== 'lost' && (s.isDemo || now - s.startedAt >= NEW_SESSION_MS));
  const inRoomKey = inRoom.map((s) => s.key).join('|');
  useEffect(() => {
    sceneRef.current?.setSessions(inRoom);
  }, [list, ready, inRoomKey]);

  // The banners change height as things happen (a 4-second error banner). Re-centring the room on
  // every change made the middle of the screen jump, so the room keeps the tallest space they needed
  // until the layout itself changes. The status bar at the bottom is one line, so it keeps its height.
  const tall = useRef({ key: '', banners: 0 });
  const layoutKey = `${vw}x${window.innerHeight}|${panelOpen}|${panelW}|${mini}|${tabsBelow}`;
  if (tall.current.key !== layoutKey) tall.current = { key: layoutKey, banners: 0 };
  const dockRoom = dockH;
  const bannersRoom = bannersH ? (tall.current.banners = Math.max(tall.current.banners, bannersH)) : 0;
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.insetRight = panelOpen ? panelW : 0;
    sc.cover = dashSplit;
    sc.insetBottom = dockRoom ? dockRoom + 24 : tabsBelow ? 36 : 0;
    sc.insetTop = mini ? 0 : bannersRoom ? bannersRoom + 66 : 56;
    sc.resize();
  }, [panelOpen, panelW, ready, mini, dockRoom, bannersRoom, tabsBelow, dashSplit]);

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

  // the menu bar icon is drawn from the pet picked in settings (the shiba if that one is gone)
  const trayPet = skins[settings.trayPet] ?? skins['builtin/shiba'];
  useEffect(() => {
    if (trayPet) void trayFrames(trayPet).then(backend.setTrayFrames).catch(() => {});
  }, [trayPet]);

  // the user's own effect sounds
  const reloadSounds = useCallback(async () => {
    soundRef.current.setCustom(await backend.listSounds().catch(() => []));
  }, []);
  useEffect(() => { void reloadSounds(); }, [reloadSounds]);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.skins = skins;
    sc.pool = petPool(settings.petPool, Object.keys(skins));
    sc.assignSkins();
  }, [settings.petPool, skins, ready]);

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

  // room camera: both atlases share one furniture layout, so pets keep their spots on a switch
  useEffect(() => {
    const view = settings.roomView ?? 'iso';
    if (!ready || sceneRef.current?.view === view) return;
    let cancelled = false;
    loadAtlas(view).then((atlas) => { if (!cancelled) sceneRef.current?.setAtlas(atlas); });
    return () => { cancelled = true; };
  }, [settings.roomView, ready]);

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
  // room-only: one size step per scroll gesture. A trackpad swipe sends dozens of events, which
  // jumped the floating room from tiny to huge at once; the next step waits for a pause.
  const wheelLock = useRef(0);
  const onWheel = async (e: React.WheelEvent<HTMLCanvasElement>) => {
    const lock = () => {
      window.clearTimeout(wheelLock.current);
      wheelLock.current = window.setTimeout(() => { wheelLock.current = 0; }, 250);
    };
    if (mini && wheelLock.current) return lock();
    wheelAcc.current += e.deltaY;
    if (Math.abs(wheelAcc.current) < 40) return;
    const dir = wheelAcc.current < 0 ? 1 : -1;
    wheelAcc.current = 0;
    if (mini) lock();
    if (!mini) {
      const sc = sceneRef.current;
      sc?.zoomBy(dir);
      try { localStorage.setItem('roomZoom', String(sc?.zoom ?? 0)); } catch { /* storage unavailable */ }
      return;
    }
    // one whole pixel scale per step; grows from the corner it sits in, so a room in a screen
    // corner stays fully visible
    const sc = sceneRef.current;
    if (!sc) return;
    const f = roomOnlyFit(sc.scale + dir);
    // smaller than this the pets and their tags can't be made out; larger fills most screens
    if (f.w >= ROOM_ONLY_MIN_W && f.w <= ROOM_ONLY_MAX_W) await resizeOnScreen(f.w, f.h);
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

  const [furnTip, setFurnTip] = useState<string | null>(null);
  const [hoverPet, setHoverPet] = useState<string | null>(null);
  // a pointed pet keeps its 'hover' tag a moment after the pointer leaves it, so the pointer can
  // cross the gap above the pet and onto the tag (which keeps it while the pointer is on it)
  const hoverOff = useRef(0);
  const hoverTo = (k: string | null) => {
    window.clearTimeout(hoverOff.current);
    if (k) setHoverPet(k);
    else hoverOff.current = window.setTimeout(() => setHoverPet(null), 400);
  };
  // the click rules (once: open the session, twice: details) are told once, when the first pet shows up
  const [petHintSeen, setPetHintSeen] = useState(() => { try { return localStorage.getItem('petHintSeen') === '1'; } catch { return true; } });
  const seePetHint = () => { setPetHintSeen(true); try { localStorage.setItem('petHintSeen', '1'); } catch { /* storage unavailable */ } };
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
  // window shortcuts (only while Agent Room is in front, never while typing)
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || settingsOpen || mini || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    const k = e.key.toLowerCase();
    if (k === 'd') { setOffice(false); setDashView(dashSplit ? 'off' : vw >= PANEL_MIN_VW ? 'split' : 'full'); }
    else if (k === 'f') { setOffice(false); setDashView(dashPage ? 'off' : 'full'); }
    else if (k === 'escape' && (dashPage || dashSplit)) setDashView('off');
    else if (k === 'n') { const next = list.find((x) => userTodo(x, now)); if (next) openApp(next.key); }
    else if (k === '/' && (dashPage || dashSplit)) { (document.querySelector('.sess-q') as HTMLInputElement | null)?.focus(); }
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  // the evening summary: once a day, after the chosen hour, with what the app counted today
  useEffect(() => {
    if (!settings.dailySummary || !IN_TAURI) return;
    const d = new Date(now);
    if (d.getHours() < (settings.dailySummaryHour ?? 18)) return;
    const ymd = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    try { if (localStorage.getItem('summaryShown') === ymd) return; localStorage.setItem('summaryShown', ymd); } catch { return; }
    const t = daySummary(day, null, Date.now());
    void backend.notifyText(L('오늘 요약', 'Today'), L(`끝낸 요청 ${t.turns}회 · 테스트 통과 ${t.testsOk}, 실패 ${t.testsFail} · 고친 파일 ${t.files}개`, `${t.turns} requests done · tests passed ${t.testsOk}, failed ${t.testsFail} · ${t.files} files edited`));
  }, [now, settings.dailySummary, settings.dailySummaryHour, day]);
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
    <div className={`app ${compact ? 'mini' : ''} ${mini ? 'room-only' : ''} ${hovered ? 'hovered' : ''} ${IS_MAC && IN_TAURI ? 'mac' : ''} ${dashPage ? 'dash-open' : ''} theme-${themeFor(settings.theme)}`} style={mini && !settingsOpen ? undefined : backdropStyle(settings)} onPointerDown={() => soundRef.current.unlock()}
      onMouseMove={mini ? (e) => pointAt.current([e.clientX, e.clientY]) : undefined} onMouseLeave={mini ? () => setHovered(false) : undefined}>
      <canvas ref={canvasRef} className="room" onClick={onCanvasClick} onMouseDown={onCanvasDown} onWheel={onWheel} onDoubleClick={onCanvasDouble}
        title={furnTip ?? undefined} onMouseLeave={() => hoverTo(null)} onMouseMove={(e) => {
          // what each piece of furniture is for, as a tooltip
          const r = e.currentTarget.getBoundingClientRect();
          const [x, y] = [e.clientX - r.left, e.clientY - r.top];
          const pet = sceneRef.current?.hitActor(x, y);
          const n = pet ? null : sceneRef.current?.furnitureAt(x, y) ?? null;
          const tip = pet && sessions[pet] ? (mini ? L('두 번 눌러서 이 세션 열기', 'Double-click to open this session') : L('눌러서 이 세션 열기 · 두 번 누르면 자세히', 'Click to open this session · double-click for details')) : n ? furnTipOf(n, list, now) : null;
          if (tip !== furnTip) setFurnTip(tip);
          const hp = pet && sessions[pet] ? pet : null;
          if (hp !== hoverPet) hoverTo(hp);
        }} />
      {/* macOS overlay title bar: drag strip behind the traffic lights (double-click zooms) */}
      {IS_MAC && IN_TAURI && !mini && <div className="titlebar" data-tauri-drag-region />}

      <div className="banners" ref={bannersRef} style={{ right: compact ? 8 : (panelOpen ? panelW : 0) + 12, left: compact ? 8 : 12 }}>
        {!IN_TAURI && !compact && !office && !dashPage && <div className="banner preview">{L('브라우저 미리보기 · 실제 에이전트와 연결되지 않은 디자인 확인용 화면입니다', 'Browser preview · a design check, not connected to real agents')}</div>}
        {(demoRunning || demoShown) && !dashPage && (
          <div className="banner demo">
            {compact ? L('데모 · 실제 에이전트 아님', 'Demo · not real agents') : L('데모 모드 · 가상 이벤트를 재생하고 있어요 (실제 에이전트 아님)', 'Demo mode · replaying made-up events (not real agents)')}
            {IN_TAURI && <button onClick={toggleDemo}>{L('끄기', 'Turn off')}</button>}
          </div>
        )}
        {update && !updDialog && (
          <div className="banner update">
            {compact ? <>{L('새 버전', 'New version')} {update.version}</> : L(`새 버전 ${update.version}이 나왔어요`, `Version ${update.version} is out`)}
            <button onClick={() => setUpdDialog({ k: 'available', u: update })}>{L('업데이트', 'Update')}</button>
          </div>
        )}
        {!compact && !office && !dashPage && list.length > (sceneRef.current?.capacity ?? 6) && (
          <div className="banner more">
            {L(`방에는 책상 수만큼 ${sceneRef.current?.capacity ?? 6}마리만 있어요 · ${list.length - (sceneRef.current?.capacity ?? 6)}개 세션 더`, `The room fits ${sceneRef.current?.capacity ?? 6} pets, one per desk · ${list.length - (sceneRef.current?.capacity ?? 6)} more sessions`)}
            <button onClick={() => { setOffice(false); setDashView(vw >= PANEL_MIN_VW ? 'split' : 'full'); }}>{L('모두 보기', 'Show all')}</button>
          </div>
        )}
        {!petHintSeen && !compact && !office && !dashPage && list.some((x) => !x.isDemo) && (
          <div className="banner hint">
            {L('펫을 한 번 누르면 그 세션이 열리고, 두 번 누르면 자세히 볼 수 있어요', 'Click a pet to open its session, double-click for details')}
            <button onClick={seePetHint}>{L('알겠어요', 'Got it')}</button>
          </div>
        )}
        {flash && <div className="banner error">{flash}</div>}
        {serverError && <div className="banner error">{L('이벤트 수신기를 시작하지 못했습니다', 'Could not start the event listener')}: {serverError}</div>}
      </div>

      <NameTags scene={sceneRef} sessions={sessions} now={now} selected={selected?.key ?? null} onSelect={openApp} hidden={settings.tagStyle === 'off'} full={settings.tagStyle === 'full'} hover={settings.tagStyle === 'hover' ? hoverPet ?? '' : null} onHover={hoverTo} pixel={settings.tagLook === 'pixel'} few={compact && !mini} short={compact || settings.tagStyle !== 'full'} doneSec={settings.doneShownSec ?? 60} idleTags={settings.idleTags ?? 'dim'} />

      {!mini && !office && (
        <div className="topleft" style={{ right: (panelOpen ? panelW : 0) + toolbarW + 24 }}>
          {!compact && <StatusPills sessions={list} now={now} onSelect={setPinned} />}
          {settings.showTabs && <SessionTabs sessions={list} selected={selected?.key ?? null} onSelect={setPinned} pinned={pinned} />}
        </div>
      )}
      {/* a small window has no room for the welcome card, so a first-time user still gets one clear next step */}
      {compact && !mini && !selected && (
        <button className="btn primary first-hint" onClick={() => setSettingsOpen('agents')}>{L('에이전트 연결하기', 'Connect agents')}</button>
      )}
      {!compact && !office && settings.showDock && (
        <div className="dock" ref={dockRef} style={{ right: panelOpen ? panelW + 12 : 12 }}>
          {selected ? (
            <Hud s={selected} now={now} onOpenApp={IN_TAURI && !selected.isDemo ? () => openApp(selected.key) : undefined} />
          ) : (
            !welcomeClosed && <Welcome detected={detected} onSettings={() => setSettingsOpen('agents')} onDemo={toggleDemo} onClose={closeWelcome} />
          )}
        </div>
      )}

      {panelOpen && !dashSplit && (
        <DetailPanel
          width={panelW}
          s={selected}
          sessions={list}
          onSelect={setPinned}
          showLimits={settings.showLimits}
          timeline={selected ? timelines[selected.key] ?? [] : []}
          tab={detailTab}
          setTab={setDetailTab}
          now={now}
          onClose={() => saveSettings({ ...settings, panelOpen: false })}
          onForget={selected && (selected.connection === 'ended' || selected.connection === 'lost') ? () => backend.removeSession(selected.key) : undefined}
        />
      )}

      <div className={`toolbar ${office ? 'faded' : ''}`} ref={toolbarRef} style={{ right: panelOpen ? panelW + 12 : 12 }}>
        {/* remaining usage for every agent, at the start of the top-right bar (the tabs make room for it) */}
        {/* with little width left the pills keep the top bar; the panel's 사용량 tab still has the numbers */}
        {!compact && !office && !mini && settings.showLimits && vw - (panelOpen ? panelW : 0) >= 1000 && (
          <UsageStrip sessions={list} now={now} onOpen={vw >= PANEL_MIN_VW ? () => { setDetailTab('usage'); if (!settings.panelOpen) void saveSettings({ ...settings, panelOpen: true }); } : undefined} />
        )}
        {!mini && <ToolBtn icon="monitor" label={L('대시보드 보기', 'Dashboard')} on={dashSplit} onClick={() => { setOffice(false); setDashView(dashSplit ? 'off' : 'split'); }} />}
        {!mini && vw >= PANEL_MIN_VW && <ToolBtn icon="panel" label={L('작업 정보 패널', 'Details panel')} on={panelOpen} onClick={() => {
          // the office-only view hides the panel, so asking for the panel leaves that view
          if (office) { setOffice(false); if (!settings.panelOpen) void saveSettings({ ...settings, panelOpen: true }); }
          else if (dashSplit) setDashView('off');
          else void saveSettings({ ...settings, panelOpen: !settings.panelOpen });
        }} />}
        {!mini && <ToolBtn icon="eye" label={office ? L('HUD 보이기', 'Show HUD') : L('사무실만 보기', 'Office only')} on={office} onClick={() => setOffice(!office)} />}
        <ToolBtn icon="mini" label={mini ? L('창으로 보기', 'Window') : L('룸만 띄우기', 'Room only')} on={mini} onClick={() => toggleMini()} />
        <ToolBtn icon={settings.roomView === 'top' ? 'iso' : 'top'} label={settings.roomView === 'top' ? L('대각선으로 보기', 'Isometric view') : L('탑다운으로 보기', 'Top-down view')} onClick={() => saveSettings({ ...settings, roomView: settings.roomView === 'top' ? 'iso' : 'top' })} />
        {/* views above, the window itself below */}
        <i className="tb-sep" aria-hidden />
        <ToolBtn icon="pin" label={L('항상 위에 표시', 'Always on top')} on={onTop} onClick={() => saveSettings({ ...settings, [onTopKey]: !onTop })} />
        <ToolBtn icon={settings.sfx ? 'sound' : 'mute'} label={settings.sfx ? L('효과음 끄기', 'Mute sounds') : L('효과음 켜기', 'Sounds on')} on={settings.sfx} onClick={() => saveSettings({ ...settings, sfx: !settings.sfx })} />
        <ToolBtn icon="gear" label={L('설정', 'Settings')} onClick={() => setSettingsOpen('last')} />
      </div>

      {(dashPage || dashSplit) && (
        <DashboardPage
          sessions={list}
          timelines={timelines}
          day={day}
          selected={selected}
          now={now}
          onSelect={setPinned}
          onOpen={openApp}
          split={dashSplit ? panelW : undefined}
          onToggleSplit={vw >= PANEL_MIN_VW ? () => setDashView(dashSplit ? 'full' : 'split') : null}
          onRoom={() => setDashView('off')}
          onSettings={() => setSettingsOpen('last')}
          accountLimits={settings.claudeAccountLimits ?? true}
          hidden={settings.dashHidden ?? []}
          historyDays={settings.historyDays ?? 0}
          cost={settings.showCost ? { claude: settings.costClaudePerM ?? 0, codex: settings.costCodexPerM ?? 0 } : undefined}
          notice={dashPage ? ((demoRunning || demoShown) ? L('데모 모드 · 실제 에이전트 아님', 'Demo mode · not real agents') : !IN_TAURI ? L('브라우저 미리보기', 'Browser preview') : null) : null}
          mac={IS_MAC && IN_TAURI}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          initialTab={settingsOpen === 'agents' ? 'agents' : null}
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

/** what the furniture is for (hover tooltip); keys are sprite names without their number */
const FURN_TIPS = (): Record<string, string> => ({
  desk: L('작업 책상 · 생각하거나 코드를 고칠 때 앉아서 종이에 적어요. 종이에 지금 상태가 그려져요', 'Desk · pets sit here to think or edit code and write on paper; the paper shows what they are doing'),
  stool: L('작업 책상 의자', 'Desk chair'),
  rig: L('테스트 장치 · 테스트나 명령을 실행할 때 여기서 작동시켜요. 불빛이 통과(초록)·실패(빨강)를 보여줘요', 'Test rig · used to run tests and commands; the light shows pass (green) or fail (red)'),
  shelf: L('책장 · 파일이나 자료를 찾을 때 와요', 'Bookshelf · where pets look up files and docs'),
  board: L('게시판 · 작업 계획(할 일 목록)을 세울 때 와요', 'Board · where pets make a plan (to-do list)'),
  sofa: L('소파 · 일이 끝나면 쉬는 곳', 'Sofa · where pets rest after work'),
  beanbag: L('빈백 · 쉬는 자리', 'Beanbag · a place to rest'),
  coffee: L('커피 카트 · 쉬는 동안 들러요', 'Coffee cart · visited while resting'),
  table: L('찻상', 'Tea table'),
});

/** what a piece of furniture is for; the test rig also says the last result it shows */
function furnTipOf(name: string, list: Snapshot[], now: number): string | null {
  const base = FURN_TIPS()[name.replace(/\d+$/, '')] ?? null;
  if (name !== 'rig') return base;
  const t = list.map((s) => s.lastTest).filter((x) => x && x.ok !== null).sort((a, b) => b!.at - a!.at)[0];
  return t ? `${base}\n${L('마지막 결과', 'Last result')}: ${t.ok ? L('통과', 'passed') : L('실패', 'failed')} · ${fmtAgo(now - t.at)}` : base;
}

const IS_MAC = /Mac/.test(navigator.userAgent);

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
