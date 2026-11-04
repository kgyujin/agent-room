import { createRoot } from 'react-dom/client';
import App from './App';
import { Popover } from './views/Popover';
import { Island } from './views/Island';
import { IN_TAURI } from './bridge';
import './styles.css';

// One page, three windows: the room ('main'), the menu bar popover ('tray') and the
// top-of-screen island ('island'). In the browser preview, ?view=tray|island picks one.
async function view(): Promise<string> {
  if (!IN_TAURI) return new URLSearchParams(location.search).get('view') ?? 'main';
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().label;
}

view().then((v) => {
  document.documentElement.classList.add(`view-${v}`);
  createRoot(document.getElementById('root')!).render(v === 'tray' ? <Popover /> : v === 'island' ? <Island /> : <App />);
});
