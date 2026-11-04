// UI colour themes. Each one sets the CSS variables the stylesheet reads, plus the
// backdrop colour the canvas paints around the room.
export interface UiTheme {
  id: string;
  name: string;
  /** backdrop around the room (window mode) */
  void: string;
  vars: Record<string, string>;
}

const t = (id: string, name: string, void_: string, c: string[]): UiTheme => {
  const [frame, frameL, box, ink, inkSoft, lineSoft, accent, accentSoft, accentInk, accentStrong, tint, tint2, page] = c;
  return {
    id, name, void: void_,
    vars: {
      '--frame': frame, '--frame-l': frameL, '--box': box, '--ink': ink, '--ink-soft': inkSoft, '--line-soft': lineSoft,
      '--accent': accent, '--accent-soft': accentSoft, '--accent-ink': accentInk, '--accent-strong': accentStrong,
      '--tint': tint, '--tint-2': tint2, '--page': page,
    },
  };
};

export const UI_THEMES: UiTheme[] = [
  t('peach', '복숭아', '#2f4a3e', ['#d98a8f', '#f7d3cf', '#fffaf6', '#5a3b44', '#94737b', '#f3d9d2', '#ff8f9c', '#ffe4e6', '#c94f60', '#d8606f', '#fdeeea', '#f6e3df', '#fbe8e0']),
  t('mint', '민트', '#2b4650', ['#6fb5a0', '#cdeadf', '#f7fdfa', '#2f4a42', '#6b8a80', '#d6eee5', '#5cc3a3', '#dcf5ec', '#2f8a6e', '#3e9e80', '#e9f7f1', '#dcefe7', '#e3f4ee']),
  t('sky', '하늘', '#2c3a55', ['#7f9fd6', '#d3e0f7', '#f8fbff', '#33405a', '#6f7d98', '#dbe5f5', '#6f9df0', '#e1ebfd', '#3e63b5', '#5079cc', '#eaf1fd', '#dfe8f8', '#e6eefb']),
  t('lavender', '라벤더', '#3a3352', ['#a58bd0', '#e3d8f5', '#fcfaff', '#45395a', '#807296', '#e8def5', '#b394ec', '#efe6fd', '#7552b8', '#8a68cc', '#f3edfc', '#e9e0f7', '#efe8fa']),
  t('lemon', '레몬', '#3c4a2e', ['#d6a94e', '#f5e2b5', '#fffdf5', '#574628', '#8f7a55', '#f3e6c6', '#f2bf3c', '#fdf1cf', '#a8751a', '#c48e22', '#fdf5df', '#f6ebcd', '#faf0d6']),
];

export function uiTheme(id: string | undefined): UiTheme {
  return UI_THEMES.find((x) => x.id === id) ?? UI_THEMES[0];
}

export function applyUiTheme(th: UiTheme) {
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(th.vars)) s.setProperty(k, v);
}
