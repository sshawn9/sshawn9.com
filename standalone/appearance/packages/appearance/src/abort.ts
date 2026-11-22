export function abortError(): Error {
  return new DOMException('Operation cancelled', 'AbortError');
}
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(signal.reason ?? abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
