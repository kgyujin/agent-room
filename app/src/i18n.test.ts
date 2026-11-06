import { afterEach, describe, expect, it } from 'vitest';
import { L, setLang } from './i18n';
import { AGENT_NAME, fmtAgo } from './labels';

describe('language', () => {
  afterEach(() => { setLang('ko'); });
  it('switches every L() and the getters', () => {
    setLang('ko');
    expect([L('완료', 'Done'), AGENT_NAME.demo, fmtAgo(120_000)]).toEqual(['완료', '데모', '2분 전']);
    expect(setLang('en')).toBe(true);
    expect([L('완료', 'Done'), AGENT_NAME.demo, fmtAgo(120_000)]).toEqual(['Done', 'Demo', '2m ago']);
  });
});
