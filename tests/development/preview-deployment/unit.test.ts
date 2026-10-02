import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPreviewAlias,
  resolvePreviewUrls,
} from '../../../apps/site/tools/deployment/preview-cli.mjs';

const cli = fileURLToPath(
  new URL('../../../apps/site/tools/deployment/preview-cli.mjs', import.meta.url),
);
const workerName = 'sshawn9-com-preview';
const stableUrl = `https://${workerName}.account.workers.dev`;
const versionUrl = `https://12345678-${workerName}.account.workers.dev`;
const versionOutput = 'Current Version ID: 12345678-abcd-abcd-abcd-123456789abc';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('stable preview aliases', () => {
  // Captured from the original Shell step, including ASCII-only normalization.
  it.each([
    ['feature/search', 'feature-search-38e7a3a2'],
    ['Feature/Search', 'feature-search-a65c1efc'],
    ['feature-search', 'feature-search-cf9ec535'],
    ['123-fix', 'branch-123-fix-6af8417c'],
    ['修复/页面', 'branch-d67e91ec'],
    ['K', 'branch-2bc4fb87'],
    ['a'.repeat(100), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-28165978'],
    ['feature/' + 'long-'.repeat(20), 'feature-long-long-long-long-long-l-3060ecae'],
  ])('preserves the existing alias for %s', (branch, expected) => {
    const alias = createPreviewAlias(branch);
    expect(alias).toBe(expected);
    expect(`${alias}-${workerName}`.length).toBeLessThanOrEqual(63);
    expect(alias).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
  });

  it('rejects a missing branch name', () => {
    expect(() => createPreviewAlias('')).toThrow('BRANCH_NAME is required');
  });
});

describe('preview deployment URLs', () => {
  it('uses the last version ID and preserves a supplied trailing slash', () => {
    expect(
      resolvePreviewUrls({
        branchName: 'main',
        deploymentUrl: stableUrl + '/',
        commandOutput: `Current Version ID: aaaaaaaa-abcd-abcd-abcd-123456789abc\n${versionOutput}\n`,
      }),
    ).toEqual({ stableUrl: stableUrl + '/', versionUrl: versionUrl + '/' });
  });

  it('keeps the immutable branch URL and derives the stable alias URL', () => {
    expect(
      resolvePreviewUrls({
        branchName: 'feature/search',
        deploymentUrl: versionUrl,
        alias: 'feature-search-38e7a3a2',
      }),
    ).toEqual({
      stableUrl: `https://feature-search-38e7a3a2-${workerName}.account.workers.dev`,
      versionUrl,
    });
  });

  it.each([
    ['missing version ID', { branchName: 'main', deploymentUrl: stableUrl }],
    [
      'wrong main URL',
      { branchName: 'main', deploymentUrl: versionUrl, commandOutput: versionOutput },
    ],
    ['missing alias', { branchName: 'feature/search', deploymentUrl: versionUrl }],
    [
      'missing deployment URL',
      { branchName: 'main', deploymentUrl: '', commandOutput: versionOutput },
    ],
    [
      'malformed URL',
      { branchName: 'main', deploymentUrl: 'not a URL', commandOutput: versionOutput },
    ],
    [
      'unexpected Worker',
      {
        branchName: 'feature/search',
        deploymentUrl: 'https://other.account.workers.dev',
        alias: 'feature-12345678',
      },
    ],
    [
      'invalid alias',
      { branchName: 'feature/search', deploymentUrl: versionUrl, alias: 'bad_alias' },
    ],
    [
      'oversized alias',
      { branchName: 'feature/search', deploymentUrl: versionUrl, alias: 'a'.repeat(64) },
    ],
    [
      'HTTP URL',
      {
        branchName: 'main',
        deploymentUrl: stableUrl.replace('https:', 'http:'),
        commandOutput: versionOutput,
      },
    ],
    [
      'multiline URL',
      {
        branchName: 'main',
        deploymentUrl: stableUrl + '\ninjected=value',
        commandOutput: versionOutput,
      },
    ],
  ])('fails instead of publishing a guessed URL for %s', (_, input) => {
    expect(() => resolvePreviewUrls(input)).toThrow();
  });
});

function run(command: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BRANCH_NAME: '',
      PREVIEW_ALIAS: '',
      DEPLOYMENT_URL: '',
      COMMAND_OUTPUT: '',
      GITHUB_OUTPUT: '',
      GITHUB_STEP_SUMMARY: '',
      ...env,
    },
  });
}

async function outputFiles() {
  const directory = await mkdtemp(join(tmpdir(), 'preview-deployment-'));
  directories.push(directory);
  const output = join(directory, 'step output');
  const summary = join(directory, 'step summary.md');
  await writeFile(output, 'existing=value\n');
  await writeFile(summary, 'Existing deployment link\n');
  return { directory, output, summary };
}

describe('preview deployment CLI', () => {
  it('prints the alias locally and appends the workflow output when provided', async () => {
    const files = await outputFiles();
    const env = { BRANCH_NAME: 'feature/search' };
    const local = run('alias', env);
    expect(local.status, local.stderr).toBe(0);
    expect(local.stdout).toBe('feature-search-38e7a3a2\n');

    const result = run('alias', { ...env, GITHUB_OUTPUT: files.output });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(files.output, 'utf8')).toBe(
      'existing=value\nalias=feature-search-38e7a3a2\n',
    );
  });

  it('appends the stable URL and both links without replacing earlier summary content', async () => {
    const files = await outputFiles();
    const result = run('urls', {
      BRANCH_NAME: 'main',
      DEPLOYMENT_URL: stableUrl,
      COMMAND_OUTPUT: versionOutput,
      GITHUB_OUTPUT: files.output,
      GITHUB_STEP_SUMMARY: files.summary,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(files.output, 'utf8')).toBe(`existing=value\nstable-url=${stableUrl}\n`);
    const summary = await readFile(files.summary, 'utf8');
    expect(summary).toMatch(/^Existing deployment link\n### Preview deployment/);
    expect(summary).toContain(`- Stable branch URL: ${stableUrl}`);
    expect(summary).toContain(`- Immutable version URL: ${versionUrl}`);
  });

  it('fails before writing outputs or summary when Wrangler did not provide a version ID', async () => {
    const files = await outputFiles();
    const result = run('urls', {
      BRANCH_NAME: 'main',
      DEPLOYMENT_URL: stableUrl,
      GITHUB_OUTPUT: files.output,
      GITHUB_STEP_SUMMARY: files.summary,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unable to resolve main preview URLs');
    expect(await readFile(files.output, 'utf8')).toBe('existing=value\n');
    expect(await readFile(files.summary, 'utf8')).toBe('Existing deployment link\n');
  });

  it('fails when the workflow output file cannot be written', async () => {
    const files = await outputFiles();
    const result = run('alias', { BRANCH_NAME: 'feature/search', GITHUB_OUTPUT: files.directory });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Preview deployment metadata failed');
  });
});
