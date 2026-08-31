export type DeferredModuleState<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed' };

export type DeferredModuleResult = 'ready' | 'failed' | 'disposed';

/** Owns one optional module request and prevents late work from escaping its page. */
export function createDeferredModule<T>(
  importModule: () => Promise<T>,
  observe: (state: DeferredModuleState<T>) => void,
) {
  let disposed = false;
  let request: Promise<DeferredModuleResult> | undefined;

  async function run(): Promise<DeferredModuleResult> {
    observe({ status: 'loading' });
    try {
      const value = await importModule();
      if (disposed) {
        return 'disposed';
      }
      observe({ status: 'ready', value });
      return 'ready';
    } catch {
      if (disposed) {
        return 'disposed';
      }
      observe({ status: 'failed' });
      return 'failed';
    }
  }

  return {
    load() {
      if (disposed) {
        return Promise.resolve<DeferredModuleResult>('disposed');
      }
      request ??= run();
      return request;
    },
    dispose() {
      disposed = true;
    },
  };
}
