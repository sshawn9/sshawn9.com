import { describe, expect, it, vi } from 'vitest';
import {
  createDeferredModule,
  type DeferredModuleState,
} from '../../apps/astro/src/runtime/deferred-module';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('deferred module lifecycle', () => {
  it('deduplicates concurrent loads and publishes one ready value', async () => {
    const module = deferred<string>();
    const importer = vi.fn(() => module.promise);
    const states: DeferredModuleState<string>[] = [];
    const controller = createDeferredModule(importer, (state) => states.push(state));

    const first = controller.load();
    const second = controller.load();
    module.resolve('ready value');

    await expect(first).resolves.toBe('ready');
    await expect(second).resolves.toBe('ready');
    expect(importer).toHaveBeenCalledOnce();
    expect(states).toEqual([{ status: 'loading' }, { status: 'ready', value: 'ready value' }]);
  });

  it('turns import rejection into an explicit failed state', async () => {
    const importer = vi.fn(() => Promise.reject(new Error('network failed')));
    const states: DeferredModuleState<string>[] = [];
    const controller = createDeferredModule(importer, (state) => states.push(state));

    await expect(controller.load()).resolves.toBe('failed');
    await expect(controller.load()).resolves.toBe('failed');
    expect(importer).toHaveBeenCalledOnce();
    expect(states).toEqual([{ status: 'loading' }, { status: 'failed' }]);
  });

  it('suppresses completion after its owner is disposed', async () => {
    const module = deferred<string>();
    const states: DeferredModuleState<string>[] = [];
    const controller = createDeferredModule(
      () => module.promise,
      (state) => states.push(state),
    );

    const result = controller.load();
    controller.dispose();
    module.resolve('late value');

    await expect(result).resolves.toBe('disposed');
    await expect(controller.load()).resolves.toBe('disposed');
    expect(states).toEqual([{ status: 'loading' }]);
  });
});
