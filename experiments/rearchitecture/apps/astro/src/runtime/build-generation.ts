export const BUILD_ID_META_NAME = 'poc-build-id';

const MAX_BUILD_ID_LENGTH = 64;
const SAFE_BUILD_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type DocumentNavigationReason =
  | 'invalid-runtime-id'
  | 'invalid-current-document-id'
  | 'invalid-target-document-id'
  | 'current-runtime-mismatch'
  | 'target-runtime-mismatch';

export type BuildGenerationDecision =
  { mode: 'client'; buildId: string } | { mode: 'document'; reason: DocumentNavigationReason };

export function normalizeBuildId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= MAX_BUILD_ID_LENGTH &&
    SAFE_BUILD_ID.test(normalized)
    ? normalized
    : undefined;
}

export function readDocumentBuildId(source: Document): string | undefined {
  return normalizeBuildId(
    source.querySelector<HTMLMetaElement>(`meta[name="${BUILD_ID_META_NAME}"]`)?.content,
  );
}

/**
 * A client swap is safe only when the running bundle and both documents agree.
 * Unknown identity is deliberately treated as a deployment boundary.
 */
export function decideBuildNavigation(
  runtimeBuildId: unknown,
  currentDocumentBuildId: unknown,
  targetDocumentBuildId: unknown,
): BuildGenerationDecision {
  const runtime = normalizeBuildId(runtimeBuildId);
  if (!runtime) {
    return { mode: 'document', reason: 'invalid-runtime-id' };
  }

  const current = normalizeBuildId(currentDocumentBuildId);
  if (!current) {
    return { mode: 'document', reason: 'invalid-current-document-id' };
  }

  const target = normalizeBuildId(targetDocumentBuildId);
  if (!target) {
    return { mode: 'document', reason: 'invalid-target-document-id' };
  }

  if (current !== runtime) {
    return { mode: 'document', reason: 'current-runtime-mismatch' };
  }

  if (target !== runtime) {
    return { mode: 'document', reason: 'target-runtime-mismatch' };
  }

  return { mode: 'client', buildId: runtime };
}
