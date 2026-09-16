/** Attempt every cleanup, in the caller's ownership order, before propagating errors. */
export function runCleanups(...cleanups: Array<() => void>): void {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Multiple cleanup operations failed.');
}

/** A rollback failure must not replace the original initialization error. */
export function rethrowAfterCleanup(error: unknown, cleanup: () => void): never {
  try {
    cleanup();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], 'Initialization and its cleanup failed.', {
      cause: error,
    });
  }
  throw error;
}
