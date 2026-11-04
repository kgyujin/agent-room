// UI colour themes (CSS variables the stylesheet reads) and the backdrops around the room.
export interface UiTheme {
  id: string;
  name: string;
  /** the theme's own backdrop around the room: centre and edge of a soft radial gradient */
  bd: [string, string];
  vars: Record<string, string>;
}

const t = (id: string, name: string, bd: [string, string], c: string[]): UiTheme => {
  const [frame, frameL, box, ink, inkSoft, lineSoft, accent, accentSoft, accentInk, accentStrong, tint, tint2, page] = c;
  return {
    id, name, bd,
    vars: {
      '--frame': frame, '--frame-l': frameL, '--box': box, '--ink': ink, '--ink-soft': inkSoft, '--line-soft': lineSoft,
      '--accent': accent, '--accent-soft': accentSoft, '--accent-ink': accentInk, '--accent-strong': accentStrong,
      '--tint': tint, '--tint-2': tint2, '--page': page,
    },
  };
};

export const UI_THEMES: UiTheme[] = [
  t('peach', '복숭아', ['#fbe3dc', '#e7b9b0'], ['#d98a8f', '#f7d3cf', '#fffaf6', '#5a3b44', '#7a5c64', '#f3d9d2', '#ff8f9c', '#ffe4e6', '#a83a4b', '#d8606f', '#fdeeea', '#f6e3df', '#fbe8e0']),
  t('mint', '민트', ['#e2f4ec', '#a9d6c5'], ['#6fb5a0', '#cdeadf', '#f7fdfa', '#2f4a42', '#56756b', '#d6eee5', '#5cc3a3', '#dcf5ec', '#236b55', '#3e9e80', '#e9f7f1', '#dcefe7', '#e3f4ee']),
  t('sky', '하늘', ['#e4eefc', '#a9c0e6'], ['#7f9fd6', '#d3e0f7', '#f8fbff', '#33405a', '#5a6884', '#dbe5f5', '#6f9df0', '#e1ebfd', '#3e63b5', '#5079cc', '#eaf1fd', '#dfe8f8', '#e6eefb']),
  t('lavender', '라벤더', ['#efe8fb', '#c3b2e3'], ['#a58bd0', '#e3d8f5', '#fcfaff', '#45395a', '#6b5d82', '#e8def5', '#b394ec', '#efe6fd', '#7552b8', '#8a68cc', '#f3edfc', '#e9e0f7', '#efe8fa']),
  t('lemon', '레몬', ['#fdf4d8', '#e6cf93'], ['#d6a94e', '#f5e2b5', '#fffdf5', '#574628', '#75613c', '#f3e6c6', '#f2bf3c', '#fdf1cf', '#87600f', '#c48e22', '#fdf5df', '#f6ebcd', '#faf0d6']),
];

/** backdrop choices; 'theme' follows the colour theme, '#rrggbb' is the user's own colour */
export const BACKDROPS: { id: string; name: string; bd: [string, string] }[] = [
  { id: 'cream', name: '크림', bd: ['#fffaf2', '#eadfcd'] },
  { id: 'meadow', name: '초원', bd: ['#e6f3dc', '#b5d4a0'] },
  { id: 'dusk', name: '해질녘', bd: ['#ffe2c9', '#c99bb5'] },
  { id: 'night', name: '밤하늘', bd: ['#3b4470', '#1d2240'] },
  { id: 'ink', name: '먹색', bd: ['#3a3a42', '#1e1e24'] },
];

const shadeHex = (h: string, k: number) => '#' + [1, 3, 5].map((i) => Math.round(Math.min(255, parseInt(h.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('');

export function backdropOf(choice: string | undefined, th: UiTheme): [string, string] {
  if (choice && /^#[0-9a-f]{6}$/i.test(choice)) return [shadeHex(choice, 1.12), shadeHex(choice, 0.86)];
  return BACKDROPS.find((b) => b.id === choice)?.bd ?? th.bd;
}

export function uiTheme(id: string | undefined): UiTheme {
  return UI_THEMES.find((x) => x.id === id) ?? UI_THEMES[0];
}

export function applyUiTheme(th: UiTheme) {
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(th.vars)) s.setProperty(k, v);
}
