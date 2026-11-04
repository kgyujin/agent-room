// Menu bar popover: the overview plus the app's main switches.
import { backend } from '../bridge';
import { Overview } from '../ui/Overview';
import { Icon } from '../ui/icons';
import { useLive } from './useLive';

export function Popover() {
  const { list, now } = useLive();
  const act = (a: string, key?: string) => void backend.trayAction(a, key);
  return (
    <div className="pop">
      <header className="pop-head">
        <b>Agent Room</b>
        <span className="muted small">{list.length ? `에이전트 ${list.length}` : '연결된 에이전트 없음'}</span>
      </header>
      <div className="pop-body">
        {list.length ? (
          <Overview sessions={list} now={now} selected={null} onSelect={(k) => act('select', k)} />
        ) : (
          <p className="muted pad">Claude Code나 Codex가 작업을 시작하면 여기에 바로 나타나요.</p>
        )}
      </div>
      <footer className="pop-foot">
        <button onClick={() => act('open')}><Icon name="panel" size={16} />방 열기</button>
        <button onClick={() => act('mini')}><Icon name="mini" size={16} />룸만 띄우기</button>
        <button onClick={() => act('settings')}><Icon name="gear" size={16} />설정</button>
        <button onClick={() => act('quit')} className="quit">종료</button>
      </footer>
    </div>
  );
}
