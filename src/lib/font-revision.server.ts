import { createHash } from 'node:crypto';
import lock from '../../package-lock.json';

const packages = lock.packages as Record<string, { version?: string }>;

const packageVersions = [
  '@fontsource-variable/manrope',
  '@fontsource-variable/source-sans-3',
  '@fontsource-variable/noto-sans-sc',
  '@fontsource-variable/jetbrains-mono',
  'katex',
].map((name) => [name, packages[`node_modules/${name}`]?.version ?? 'missing']);

export const FONT_REVISION = createHash('sha256')
  .update(
    JSON.stringify({
      contract: 3,
      packageVersions,
    }),
  )
  .digest('hex')
  .slice(0, 16);
