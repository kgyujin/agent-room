// Builds the `agent-room-hook` binary and places it where Tauri expects a sidecar
// (src-tauri/binaries/agent-room-hook-<target-triple>).
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const release = process.argv.includes('--release');
const targetArg = process.argv.find((a) => a.startsWith('--target='))?.slice(9);
const triple = targetArg ?? execSync('rustc -vV').toString().match(/host: (\S+)/)[1];
const ext = triple.includes('windows') ? '.exe' : '';
execSync(`cargo build -p agent-room-hook ${release ? '--release' : ''} ${targetArg ? `--target ${targetArg}` : ''}`, { cwd: root, stdio: 'inherit' });
const profile = release ? 'release' : 'debug';
const src = join(root, 'target', ...(targetArg ? [targetArg] : []), profile, `agent-room-hook${ext}`);
const dstDir = join(root, 'app', 'src-tauri', 'binaries');
mkdirSync(dstDir, { recursive: true });
copyFileSync(src, join(dstDir, `agent-room-hook-${triple}${ext}`));
console.log(`hook sidecar -> binaries/agent-room-hook-${triple}${ext}`);
