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
  const help = spawnSync(binary, ['http', '--help'], { encoding: 'utf8', shell: false });
  if (
    version.error ||
    version.status !== 0 ||
    help.error ||
    help.status !== 0 ||
    !/--json\b/.test(help.stdout) ||
    !/--ci\b/.test(help.stdout)
  ) {
    console.error('已安装的 CLI 未通过 version / http --help 兼容性检查。');
    process.exitCode = 1;
  } else {
    console.log(`${binary}\n${version.stdout.trim()}`);
  }
}
