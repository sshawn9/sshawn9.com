import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workerName = 'sshawn9-com-preview';

function required(value, name) {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required.`);
  return value;
}

function validateAlias(alias) {
  if (!/^[a-z][a-z0-9-]*$/.test(alias) || alias.length + 1 + workerName.length > 63) {
    throw new Error('Invalid preview alias or combined DNS label length.');
  }
}

/** Preserve the original ASCII normalization and hash so existing branch URLs stay stable. */
export function createPreviewAlias(branchName) {
  required(branchName, 'BRANCH_NAME');
  let normalized =
    branchName
      .replace(/[A-Z]/g, (character) => character.toLowerCase())
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'branch';
  if (!/^[a-z]/.test(normalized)) normalized = `branch-${normalized}`;
  const fingerprint = createHash('sha256').update(branchName).digest('hex').slice(0, 8);
  const maxBaseLength = 63 - 1 - workerName.length - 1 - fingerprint.length;
  normalized = normalized.slice(0, maxBaseLength).replace(/-$/, '');
  const alias = `${normalized}-${fingerprint}`;
  validateAlias(alias);
  return alias;
}

/** Resolve Wrangler's stable main URL or immutable branch version URL without network requests. */
export function resolvePreviewUrls({ branchName, deploymentUrl, alias = '', commandOutput = '' }) {
  required(branchName, 'BRANCH_NAME');
  required(deploymentUrl, 'DEPLOYMENT_URL');
  const url = new URL(deploymentUrl);
  if (
    /\s/.test(deploymentUrl) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid preview deployment URL.');
  }

  if (branchName === 'main') {
    const versions = commandOutput.matchAll(
      /Current Version ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g,
    );
    const versionId = [...versions].at(-1)?.[1];
    if (!versionId || !deploymentUrl.startsWith(`https://${workerName}.`)) {
      throw new Error('Unable to resolve main preview URLs from the Wrangler deployment output.');
    }
    return {
      stableUrl: deploymentUrl,
      versionUrl: deploymentUrl.replace(
        `https://${workerName}.`,
        `https://${versionId.slice(0, 8)}-${workerName}.`,
      ),
    };
  }

  required(alias, 'PREVIEW_ALIAS');
  validateAlias(alias);
  const stableUrl = deploymentUrl.replace(
    new RegExp(`^https://[^.]+-${workerName}\\.`),
    `https://${alias}-${workerName}.`,
  );
  if (stableUrl === deploymentUrl) {
    throw new Error('Unable to derive the stable preview URL from the Wrangler deployment URL.');
  }
  return { stableUrl, versionUrl: deploymentUrl };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', default: false } },
  });
  const usage = [
    'Usage: npm run deployment:preview-alias   (BRANCH_NAME)',
    '       npm run deployment:preview-urls    (BRANCH_NAME, DEPLOYMENT_URL, PREVIEW_ALIAS or COMMAND_OUTPUT)',
    'Results are printed and appended to GITHUB_OUTPUT / GITHUB_STEP_SUMMARY when set.',
  ].join('\n');
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length !== 1 || !['alias', 'urls'].includes(positionals[0])) {
    throw new Error(usage);
  }

  if (positionals[0] === 'alias') {
    const alias = createPreviewAlias(process.env.BRANCH_NAME);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `alias=${alias}\n`);
    }
    console.log(alias);
    return;
  }

  const { stableUrl, versionUrl } = resolvePreviewUrls({
    branchName: process.env.BRANCH_NAME,
    deploymentUrl: process.env.DEPLOYMENT_URL,
    alias: process.env.PREVIEW_ALIAS,
    commandOutput: process.env.COMMAND_OUTPUT,
  });
  const summary = [
    '### Preview deployment',
    '',
    `- Stable branch URL: ${stableUrl}`,
    `- Immutable version URL: ${versionUrl}`,
    '',
  ].join('\n');
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `stable-url=${stableUrl}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  console.log(summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Preview deployment metadata failed: ${error.message}`);
    process.exitCode = 1;
  }
}
