// Menu bar popover: the overview plus the app's main switches.
import { useEffect, useState } from 'react';
import { backend } from '../bridge';
import { Limits, Overview } from '../ui/Overview';
import { UsageBoard } from '../ui/Usage';
import { Icon } from '../ui/icons';
import { useLive } from './useLive';

export function Popover() {
  const { list, now, settings, running } = useLive();
  const act = (a: string, key?: string) => void backend.trayAction(a, key);
  // with nothing connected yet, an empty list would wait forever: point straight at the fix
  const [unhooked, setUnhooked] = useState(false);
  const [tab, setTab] = useState<'now' | 'usage'>('now');
  useEffect(() => {
    if (!list.length) void backend.hooksStatus().then((h) => setUnhooked(h.every((x) => x.installed === 'none'))).catch(() => {});
  }, [list.length]);
  return (
    <div className="pop">
      <header className="pop-head">
        <b>Agent Room</b>
        <nav className="pop-tabs">
          <button className={tab === 'now' ? 'on' : ''} onClick={() => setTab('now')}>현황{list.length ? ` ${list.length}` : ''}</button>
          <button className={tab === 'usage' ? 'on' : ''} onClick={() => setTab('usage')}>사용량</button>
        </nav>
      </header>
      <div className="pop-body">
        {tab === 'usage' ? (
          <div className="pad"><UsageBoard sessions={list} now={now} /></div>
        ) : list.length ? (
          <Overview sessions={list} now={now} selected={null} onSelect={(k) => act('select', k)} showLimits={settings?.showLimits ?? true} limitsFirst />
        ) : (
          <div className="pad">
            <p className="muted">{!unhooked && running ? `에이전트 ${running}개가 실행 중이에요. ` : ''}{unhooked ? '아직 연결된 에이전트가 없어요. 연결하면 Claude Code나 Codex가 일할 때 여기에 바로 나타나요.' : 'Claude Code나 Codex가 작업을 시작하면 여기에 바로 나타나요.'}</p>
            {unhooked && <button className="btn primary" onClick={() => act('settings', 'agents')}>에이전트 연결하기</button>}
            {(settings?.showLimits ?? true) && <div className="ov pop-lim"><Limits sessions={list} now={now} /></div>}
          </div>
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
