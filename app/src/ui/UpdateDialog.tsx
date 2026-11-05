// Asks before updating: shows the installed and the newest version, then downloads with progress.
// Opened from the app menu / menu bar ("업데이트 확인…"), from Settings, or by the automatic check.
import { useEffect } from 'react';
import { appVersion, checkUpdate, type AppUpdate } from '../bridge';
import { Icon } from './icons';

export type UpdateState =
  | { k: 'checking' }
  | { k: 'latest'; current: string }
  | { k: 'available'; u: AppUpdate }
  | { k: 'installing'; u: AppUpdate; pct: number }
  | { k: 'error'; msg: string; u?: AppUpdate };

/** runs a check and reports the result as a dialog state */
export async function runCheck(): Promise<UpdateState> {
  try {
    const u = await checkUpdate();
    return u ? { k: 'available', u } : { k: 'latest', current: await appVersion() };
  } catch (e) {
    return { k: 'error', msg: `업데이트 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. (${String(e)})` };
  }
}

export function UpdateDialog({ state, setState, onClose }: { state: UpdateState; setState: (s: UpdateState) => void; onClose: () => void }) {
  const busy = state.k === 'checking' || state.k === 'installing';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const install = (u: AppUpdate) => {
    setState({ k: 'installing', u, pct: 0 });
    u.install((pct) => setState({ k: 'installing', u, pct })).catch((e) =>
      setState({ k: 'error', u, msg: `업데이트를 설치하지 못했어요. 잠시 뒤 다시 해 보거나, GitHub 릴리스 페이지(kgyujin/agent-room)에서 새 .dmg를 받아 주세요. (${String(e)})` }),
    );
  };
  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <div className="modal card upd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="업데이트">
        <header>
          <b>업데이트</b>
          {!busy && <button className="tool" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>}
        </header>
        <div className="modal-body">
          {state.k === 'checking' && <p className="upd-msg">새 버전이 있는지 확인하고 있어요…</p>}
          {state.k === 'latest' && (
            <>
              <p className="upd-msg"><Icon name="check" /> 최신 버전을 쓰고 있어요.</p>
              <Versions current={state.current} latest={state.current} />
            </>
          )}
          {(state.k === 'available' || state.k === 'installing') && (
            <>
              <p className="upd-msg">새 버전이 나왔어요. 지금 업데이트할까요?</p>
              <Versions current={state.u.current} latest={state.u.version} />
              {state.k === 'installing' && (
                <div className="upd-prog">
                  <span className="pn-bar"><i style={{ width: `${state.pct}%` }} /></span>
                  <small>{state.pct < 100 ? `받는 중 ${state.pct}%` : '설치하고 다시 시작하는 중…'}</small>
                </div>
              )}
            </>
          )}
          {state.k === 'error' && (
            <>
              <p className="upd-msg bad">{state.msg}</p>
              {state.u && <Versions current={state.u.current} latest={state.u.version} />}
            </>
          )}
          <div className="upd-actions">
            {state.k === 'available' && (
              <>
                <button className="btn" onClick={onClose}>나중에</button>
                <button className="btn primary" onClick={() => install(state.u)}>지금 업데이트</button>
              </>
            )}
            {state.k === 'error' && (
              <>
                <button className="btn" onClick={onClose}>닫기</button>
                <button className="btn primary" onClick={() => { setState({ k: 'checking' }); void runCheck().then(setState); }}>다시 확인</button>
              </>
            )}
            {state.k === 'latest' && <button className="btn primary" onClick={onClose}>확인</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Versions({ current, latest }: { current: string; latest: string }) {
  return (
    <dl className="upd-ver">
      <div><dt>지금 버전</dt><dd>{current}</dd></div>
      <div><dt>최신 버전</dt><dd className={current !== latest ? 'new' : ''}>{latest}</dd></div>
    </dl>
  );
}
