#!/usr/bin/env node
// `npx github:kgyujin/agent-room [install|uninstall]`: installs (or updates) the latest Agent Room
// release into /Applications and opens it, or removes it together with its agent hooks.
// It downloads the .dmg from GitHub Releases and copies the app out of it, nothing else.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'kgyujin/agent-room';
const APP = 'Agent Room.app';
const DEST = path.join('/Applications', APP);
const HOOK = path.join(os.homedir(), '.agent-room', 'bin', 'agent-room-hook');
const NPX = `npx github:${REPO}`;

function fail(msg) {
  console.error(`\n실패했어요: ${msg}`);
  process.exit(1);
}

/** a running copy would keep the old version, and opening the new one would only bring it forward */
function quitApp() {
  try {
    execFileSync('/usr/bin/osascript', ['-e', 'if application "Agent Room" is running then quit app "Agent Room"'], { stdio: 'ignore' });
  } catch { /* could not ask it to quit */ }
}

async function install() {
  if (os.arch() !== 'arm64') fail('지금은 Apple Silicon(M1 이상) Mac용만 있어요.');
  console.log('최신 버전을 확인하는 중…');
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) fail(`GitHub에서 릴리스 정보를 받지 못했어요 (HTTP ${res.status}).`);
  const release = await res.json();
  const asset = (release.assets || []).find((a) => a.name.endsWith('.dmg'));
  if (!asset) fail('릴리스에 .dmg 파일이 없어요.');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-room-'));
  const dmg = path.join(tmp, 'AgentRoom.dmg');
  const mnt = path.join(tmp, 'mnt');
  try {
    console.log(`${release.tag_name} 받는 중… (${(asset.size / 1e6).toFixed(1)} MB)`);
    const dl = await fetch(asset.browser_download_url);
    if (!dl.ok) fail(`내려받지 못했어요 (HTTP ${dl.status}).`);
    fs.writeFileSync(dmg, Buffer.from(await dl.arrayBuffer()));
    quitApp();
    console.log('/Applications에 설치하는 중…');
    fs.mkdirSync(mnt);
    execFileSync('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, dmg], { stdio: 'ignore' });
    try {
      const src = path.join(mnt, APP);
      if (!fs.existsSync(src)) fail('.dmg 안에서 앱을 찾지 못했어요.');
      fs.rmSync(DEST, { recursive: true, force: true });
      execFileSync('/usr/bin/ditto', [src, DEST]);
    } finally {
      execFileSync('/usr/bin/hdiutil', ['detach', mnt, '-quiet'], { stdio: 'ignore' });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n설치했어요: ${DEST} (${release.tag_name})`);
  console.log('처음이면 앱의 안내 카드에서 Claude Code·Codex를 연결하세요. 다음부터는 앱 안에서 업데이트돼요.');
  execFileSync('/usr/bin/open', [DEST]);
}

function uninstall() {
  // the hooks first: they live in the agents' own settings, outside the app
  if (fs.existsSync(HOOK)) {
    console.log('Claude Code·Codex 설정에서 Agent Room Hook을 빼는 중…');
    try {
      execFileSync(HOOK, ['--uninstall'], { stdio: 'inherit' });
    } catch {
      console.log('Hook을 빼지 못했어요. 앱의 설정 → 고급에서 다시 시도하세요.');
    }
  }
  quitApp();
  if (fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true, force: true });
    console.log(`지웠어요: ${DEST}`);
  } else {
    console.log('설치된 앱이 없어요.');
  }
  console.log(`설정 백업은 ${path.join(os.homedir(), '.agent-room')}에 남겨 뒀어요. 필요 없으면 직접 지우세요.`);
}

function help() {
  console.log(`Agent Room 설치 도구

  ${NPX}              최신 버전 설치·업데이트
  ${NPX} uninstall    앱과 에이전트 Hook 제거`);
}

async function main() {
  const cmd = process.argv[2] ?? 'install';
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') return help();
  if (process.platform !== 'darwin') fail('Agent Room은 macOS 앱이에요.');
  if (cmd === 'install' || cmd === 'update') return install();
  if (cmd === 'uninstall' || cmd === 'remove') return uninstall();
  help();
  process.exit(1);
}

main().catch((e) => fail(e.message));
