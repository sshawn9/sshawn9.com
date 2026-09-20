import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../.tools/bin/', import.meta.url));
await mkdir(directory, { recursive: true });
const install = spawnSync('go', ['install', 'github.com/jsdelivr/globalping-cli@latest'], {
  env: { ...process.env, GOBIN: directory },
  stdio: 'inherit',
  shell: false,
});
if (install.error || install.status !== 0) {
  console.error(install.error?.message ?? 'Globalping CLI 安装失败。');
  process.exitCode = 1;
} else {
  const binary = `${directory}globalping-cli`;
  const version = spawnSync(binary, ['version'], { encoding: 'utf8', shell: false });
  if (version.error || version.status !== 0) {
    console.error(version.error?.message ?? '无法读取已安装的 Globalping CLI 版本。');
    process.exitCode = 1;
  } else {
    console.log(`${binary}\n${version.stdout.trim()}`);
  }
}
