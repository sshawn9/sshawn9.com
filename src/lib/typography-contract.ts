export const TYPOGRAPHY_FAMILIES = {
  display: '--font-manrope',
  body: '--font-source-sans-3',
  cjk: 'Noto Sans SC Variable',
  mono: 'JetBrains Mono Variable',
} as const;

export type TypographyState = 'cold' | 'warm' | 'revealing' | 'ready' | 'degraded';

export const TYPOGRAPHY_REVEAL_MS = 240;
export const TYPOGRAPHY_TIMEOUT_MS = 8_000;
