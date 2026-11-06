import { createRoot } from 'react-dom/client';
import { IN_TAURI } from './bridge';
import './styles.css';

// One page, four windows: the room ('main'), the menu bar popover ('tray'), the
// top-of-screen island ('island') and the desktop pets' strip ('desk'). In the browser preview, ?view=tray|island|desk picks one.
async function view(): Promise<string> {
  if (!IN_TAURI) return new URLSearchParams(location.search).get('view') ?? 'main';
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().label;
}

// each window loads only its own view's code: the popover and the island don't parse the room,
// the dashboard and the settings
view().then(async (v) => {
  document.documentElement.classList.add(`view-${v}`);
  const Page = v === 'tray' ? (await import('./views/Popover')).Popover : v === 'island' ? (await import('./views/Island')).Island : v === 'desk' ? (await import('./views/Desk')).Desk : (await import('./App')).default;
  createRoot(document.getElementById('root')!).render(<Page />);
});
