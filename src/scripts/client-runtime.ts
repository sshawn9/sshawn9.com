type Cleanup = () => void;

type ClientRuntimeRegistry = Map<string, Cleanup>;

type RuntimeGlobal = typeof globalThis & {
  __sshawn9ClientRuntimes?: ClientRuntimeRegistry;
};

export function claimClientRuntime(name: string) {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  const registry = (runtimeGlobal.__sshawn9ClientRuntimes ??= new Map());
  registry.get(name)?.();

  const cleanups = new Set<Cleanup>();
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
    cleanups.clear();
    if (registry.get(name) === dispose) registry.delete(name);
  };

  registry.set(name, dispose);

  return {
    listen(
      target: EventTarget,
      type: string,
      listener: EventListener,
      options?: boolean | AddEventListenerOptions,
    ) {
      target.addEventListener(type, listener, options);
      cleanups.add(() => target.removeEventListener(type, listener, options));
    },
    onDispose(cleanup: Cleanup) {
      cleanups.add(cleanup);
    },
  };
}
