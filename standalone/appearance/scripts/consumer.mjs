import { mkdtemp, cp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'appearance-consumer-'));
const consumer = join(temporary, 'demo');
const run = (args, cwd = root, env = {}) => {
  console.log('$ npm ' + args.join(' ') + ' (cwd: ' + cwd + ')');
  const result = spawnSync('npm', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.status !== 0) throw new Error('npm command failed: ' + args.join(' '));
  return result.stdout;
};
await mkdir(join(root, '.results'), { recursive: true });
console.log('Clean consumer: ' + consumer);
run(['run', 'build', '-w', '@sshawn9/appearance']);
const packed = run(['pack', '-w', '@sshawn9/appearance', '--json', '--pack-destination', temporary]);
const artifact = JSON.parse(packed.slice(packed.indexOf('[')))[0];
const tarball = join(temporary, artifact.filename);
await cp(join(root, 'apps/demo'), consumer, { recursive: true, filter: source => !source.split('/').some(part => ['node_modules', 'dist'].includes(part)) });
const manifestPath = join(consumer, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.dependencies = { ...manifest.dependencies, '@sshawn9/appearance': 'file:' + tarball };
manifest.devDependencies = { typescript: '6.0.3', ...manifest.devDependencies };
delete manifest.workspaces;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
run(['install'], consumer);
run(['run', 'check'], consumer);
run(['run', 'build'], consumer);
const check = `import { readFile } from 'node:fs/promises';
await import('@sshawn9/appearance/theme');
await import('@sshawn9/appearance/wallpaper');
for (const name of ['@sshawn9/appearance/styles.css','@sshawn9/appearance/theme/styles.css','@sshawn9/appearance/wallpaper/styles.css']) {
  const text = await readFile(new URL(import.meta.resolve(name)), 'utf8');
  if (!text.trim()) throw new Error('Empty public stylesheet: ' + name);
}
console.log('Packed JavaScript and stylesheet exports resolve in clean consumer');
`;
await writeFile(join(consumer, 'verify-exports.mjs'), check);
const checkResult = spawnSync(process.execPath, ['verify-exports.mjs'], { cwd: consumer, stdio: 'inherit' });
if (checkResult.status !== 0) throw new Error('Packed public exports failed');
const assets = await readdir(join(consumer, 'dist/assets'));
if (!assets.some(name => name.includes('source-sans-3-latin-wght-normal') && name.endsWith('.woff2'))) throw new Error('Consumer font dependency was not emitted as a separate local resource');
run(['exec', '--', 'playwright', 'test'], root, { APPEARANCE_DEMO_ROOT: consumer, APPEARANCE_PORT: '4487', APPEARANCE_RESULTS: join(root, '.results/consumer') });
await writeFile(join(root, '.results/consumer-summary.json'), JSON.stringify({ consumer, tarball, package: artifact, status: 'passed' }, null, 2));
console.log('Clean packed consumer build and Chromium/Firefox browser tests passed');
