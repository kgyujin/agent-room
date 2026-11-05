#!/usr/bin/env node
// `npx github:kgyujin/agent-room`: installs the latest Agent Room release into /Applications and opens it.
// It downloads the .dmg from GitHub Releases, copies the app out of it and nothing else.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'kgyujin/agent-room';
const APP = 'Agent Room.app';
const DEST = path.join('/Applications', APP);

function fail(msg) {
  console.error(`\n설치하지 못했어요: ${msg}`);
  process.exit(1);
}

async function main() {
  if (process.platform !== 'darwin') fail('Agent Room은 macOS 앱이에요.');
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

    // a running copy would stay the old version, and opening the new one would only bring it forward
    try {
      execFileSync('/usr/bin/osascript', ['-e', 'if application "Agent Room" is running then quit app "Agent Room"'], { stdio: 'ignore' });
    } catch { /* could not ask it to quit */ }

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

  console.log(`\n설치했어요: ${DEST} (${release.tag_name})\n다음부터는 앱 안에서 업데이트돼요.`);
  execFileSync('/usr/bin/open', [DEST]);
}

main().catch((e) => fail(e.message));
