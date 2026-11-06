import { createRoot } from 'react-dom/client';
import App from './App';
import { Popover } from './views/Popover';
import { Island } from './views/Island';
import { Desk } from './views/Desk';
import { IN_TAURI } from './bridge';
import './styles.css';

// One page, four windows: the room ('main'), the menu bar popover ('tray'), the
// top-of-screen island ('island') and the desktop pets' strip ('desk'). In the browser preview, ?view=tray|island|desk picks one.
async function view(): Promise<string> {
  if (!IN_TAURI) return new URLSearchParams(location.search).get('view') ?? 'main';
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().label;
}

view().then((v) => {
  document.documentElement.classList.add(`view-${v}`);
  createRoot(document.getElementById('root')!).render(v === 'tray' ? <Popover /> : v === 'island' ? <Island /> : v === 'desk' ? <Desk /> : <App />);
});
