import { SITE_STORAGE_KEYS } from '../lib/site-preferences';
import {
  TYPOGRAPHY_FAMILIES,
  TYPOGRAPHY_REVEAL_MS,
  TYPOGRAPHY_TIMEOUT_MS,
  type TypographyState,
} from '../lib/typography-contract';

type FontRequirement = {
  descriptor: string;
  text: string;
};

type PreparationResult = 'ready' | 'degraded';

const CJK_PATTERN =
  /[\u2e80-\u303f\u3040-\u30ff\u3100-\u312f\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u{20000}-\u{2fa1f}]/u;
const CODE_SELECTOR = 'code, pre, .expressive-code, .version-diff-panel';
const MONO_SELECTOR = `${CODE_SELECTOR}, .font-mono, [font-family*="--font-mono"]`;
const LATIN_FONT_PROBE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

let resolveBootstrap: ((result: PreparationResult) => void) | undefined;
const bootstrapPreparation: Promise<PreparationResult> =
  typeof document === 'undefined'
    ? Promise.resolve('ready')
    : new Promise((resolve) => {
        resolveBootstrap = resolve;
      });
let activePreparation: Promise<PreparationResult> = bootstrapPreparation;
let initialStart: Promise<PreparationResult> | undefined;

function uniqueCharacters(value: string, predicate?: (character: string) => boolean) {
  const characters = new Set<string>();
  for (const character of value) {
    if (!predicate || predicate(character)) characters.add(character);
  }
  return [...characters].join('');
}

function textFrom(target: Document, selector?: string) {
  const elements = selector
    ? [...target.querySelectorAll<HTMLElement>(selector)]
    : target.body
      ? [target.body]
      : [];
  return elements.map((element) => element.textContent ?? '').join(' ');
}

function resolveFamily(reference: string) {
  if (!reference.startsWith('--')) return reference;

  const stack = getComputedStyle(document.documentElement).getPropertyValue(reference).trim();
  const firstFamily = stack.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
  return firstFamily?.[1] ?? firstFamily?.[2] ?? firstFamily?.[3]?.trim() ?? reference;
}

function requirement(familyReference: string, text: string, style = 'normal', weight = 400) {
  const family = resolveFamily(familyReference);
  return {
    descriptor: `${style} ${weight} 1em "${family}"`,
    text,
  } satisfies FontRequirement;
}

function katexRequirements(target: Document) {
  if (!target.querySelector('.katex')) return [];

  const core = [
    requirement('KaTeX_AMS', 'ABΓ∫'),
    requirement('KaTeX_Main', 'Aa09+=()'),
    requirement('KaTeX_Main', 'Aa09', 'normal', 700),
    requirement('KaTeX_Main', 'Aa09', 'italic'),
    requirement('KaTeX_Main', 'Aa09', 'italic', 700),
    requirement('KaTeX_Math', 'xyφκ', 'italic'),
    requirement('KaTeX_Math', 'xyφκ', 'italic', 700),
    requirement('KaTeX_Size1', '()[]{}∫'),
    requirement('KaTeX_Size2', '()[]{}∫'),
    requirement('KaTeX_Size3', '()[]{}∫'),
    requirement('KaTeX_Size4', '()[]{}∫'),
  ];

  const optional: FontRequirement[] = [];
  if (target.querySelector('.mathcal, .mathscr')) {
    optional.push(requirement('KaTeX_Caligraphic', 'ABC'), requirement('KaTeX_Script', 'ABC'));
  }
  if (target.querySelector('.mathfrak')) {
    optional.push(
      requirement('KaTeX_Fraktur', 'ABC'),
      requirement('KaTeX_Fraktur', 'ABC', 'normal', 700),
    );
  }
  if (target.querySelector('.mathsf')) {
    optional.push(
      requirement('KaTeX_SansSerif', 'ABC'),
      requirement('KaTeX_SansSerif', 'ABC', 'normal', 700),
    );
  }
  if (target.querySelector('.mathtt')) optional.push(requirement('KaTeX_Typewriter', 'ABC123'));

  return [...core, ...optional];
}

function codeRequirements(codeText: string) {
  if (!codeText) return [];

  const monoText = uniqueCharacters(
    `${LATIN_FONT_PROBE}${codeText}`,
    (character) => !CJK_PATTERN.test(character),
  );
  const requirements = [
    requirement(TYPOGRAPHY_FAMILIES.mono, monoText),
    requirement(TYPOGRAPHY_FAMILIES.mono, monoText, 'italic'),
  ];
  const codeCjkText = uniqueCharacters(codeText, (character) => CJK_PATTERN.test(character));
  if (codeCjkText) requirements.push(requirement(TYPOGRAPHY_FAMILIES.cjk, codeCjkText));
  return requirements;
}

function requirementsFor(target: Document) {
  const pageText = textFrom(target);
  const cjkText = uniqueCharacters(pageText, (character) => CJK_PATTERN.test(character));
  const requirements = [
    requirement(TYPOGRAPHY_FAMILIES.display, LATIN_FONT_PROBE),
    requirement(TYPOGRAPHY_FAMILIES.body, LATIN_FONT_PROBE),
  ];

  if (target.querySelector('em, i')) {
    requirements.push(requirement(TYPOGRAPHY_FAMILIES.body, LATIN_FONT_PROBE, 'italic'));
  }
  if (cjkText) requirements.push(requirement(TYPOGRAPHY_FAMILIES.cjk, cjkText));

  if (target.querySelector(MONO_SELECTOR)) {
    requirements.push(requirement(TYPOGRAPHY_FAMILIES.mono, LATIN_FONT_PROBE));
  }

  const codeText = uniqueCharacters(textFrom(target, CODE_SELECTOR));
  requirements.push(...codeRequirements(codeText));

  requirements.push(...katexRequirements(target));
  return requirements;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

async function loadRequirements(requirements: FontRequirement[], signal?: AbortSignal) {
  if (!document.fonts) return 'ready' as const;
  if (signal?.aborted) throw abortError(signal);

  let timeoutId = 0;
  let removeAbortListener = () => {};
  const timeout = new Promise<PreparationResult>((resolve) => {
    timeoutId = window.setTimeout(() => resolve('degraded'), TYPOGRAPHY_TIMEOUT_MS);
  });
  const aborted = signal
    ? new Promise<never>((_resolve, reject) => {
        const abort = () => reject(abortError(signal));
        signal.addEventListener('abort', abort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', abort);
      })
    : new Promise<never>(() => {});

  const loading = Promise.all(
    requirements.map(async ({ descriptor, text }) => {
      const faces = await document.fonts.load(descriptor, text);
      return faces.length > 0;
    }),
  ).then(async (loaded) => {
    await document.fonts.ready;
    return loaded.every(Boolean) ? ('ready' as const) : ('degraded' as const);
  });

  try {
    return await Promise.race([loading, timeout, aborted]);
  } finally {
    window.clearTimeout(timeoutId);
    removeAbortListener();
  }
}

export function prepareTypography(target: Document, signal?: AbortSignal) {
  activePreparation = loadRequirements(requirementsFor(target), signal).catch((error) => {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.warn('Typography preparation failed; using local fallbacks.', error);
    return 'degraded';
  });
  return activePreparation;
}

export async function prepareCodeTypography(codeText: string, signal?: AbortSignal) {
  try {
    return await loadRequirements(codeRequirements(codeText), signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.warn('Code typography preparation failed; using local fallbacks.', error);
    return 'degraded' as const;
  }
}

export function whenTypographyReady() {
  return activePreparation;
}

function writeRootState(state: TypographyState) {
  document.documentElement.dataset.fontState = state;
}

function persistReadyRevision() {
  const revision = document.documentElement.dataset.fontRevision;
  if (!revision) return;

  try {
    const currentKey = `${SITE_STORAGE_KEYS.fontReadyPrefix}${revision}`;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(SITE_STORAGE_KEYS.fontReadyPrefix) && key !== currentKey) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(currentKey, 'ready');
  } catch {
    // Storage is an optimization only; the font loading contract still holds without it.
  }
}

export function startTypographyController() {
  if (initialStart) return initialStart;

  const initialState = document.documentElement.dataset.fontState;
  initialStart = prepareTypography(document).then((result) => {
    resolveBootstrap?.(result);
    resolveBootstrap = undefined;
    if (result === 'degraded') {
      writeRootState('degraded');
      return result;
    }

    persistReadyRevision();
    if (initialState !== 'cold' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      writeRootState('ready');
      return result;
    }

    writeRootState('revealing');
    window.setTimeout(() => writeRootState('ready'), TYPOGRAPHY_REVEAL_MS);
    return result;
  });

  return initialStart;
}
