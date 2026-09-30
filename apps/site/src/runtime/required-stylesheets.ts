type StylePreparationOptions = { signal?: AbortSignal };

function stylesheetIdentity(link: HTMLLinkElement, base: string): string {
  const url = new URL(link.href, base);
  url.searchParams.delete('style-retry');
  return url.href;
}

/** Successful stylesheets are prerequisites for applying the required typography. */
export function prepareRequiredStylesheets(
  sourceDocument: Document,
  declarationDocument: Document = sourceDocument,
  { signal }: StylePreparationOptions = {},
): void | Promise<void> {
  const existing = Array.from(
    sourceDocument.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );
  const missing = Array.from(
    declarationDocument.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).filter((link) => {
    if (link.disabled) return false;
    if (link.media && !sourceDocument.defaultView?.matchMedia(link.media).matches) return false;
    const identity = stylesheetIdentity(link, sourceDocument.baseURI);
    const reusable = existing.find((current) => {
      if (stylesheetIdentity(current, sourceDocument.baseURI) !== identity || !current.sheet)
        return false;
      // Failed stylesheets can retain an inaccessible or empty sheet. Parsed
      // rules prove availability; otherwise verify success with a load event.
      // A genuinely empty stylesheet is accepted when that request succeeds.
      try {
        return current.sheet.cssRules.length > 0;
      } catch {
        return false;
      }
    });
    if (!reusable) return true;

    // Astro preserves a head stylesheet only when its href attribute matches.
    // Keep the actual node and its repaired font rules, not just the same file.
    const href = reusable.getAttribute('href')!;
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    return false;
  });
  if (missing.length === 0) return;

  const native = sourceDocument === declarationDocument;
  return Promise.all(
    missing.map(
      (link) =>
        new Promise<void>((resolve, reject) => {
          const original = new URL(link.href, sourceDocument.baseURI);
          let attempt = Number(original.searchParams.get('style-retry')) + (native ? 1 : 0);
          let request: HTMLLinkElement | undefined;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let resource = original;

          const releaseRequest = () => {
            request?.removeEventListener('load', loaded);
            request?.removeEventListener('error', failed);
            if (!native) request?.remove();
            request = undefined;
          };
          const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            releaseRequest();
          };
          const abort = () => {
            cleanup();
            reject(new DOMException('Stylesheet preparation was superseded', 'AbortError'));
          };
          const loaded = () => {
            if (signal?.aborted) return abort();
            if (resource.href !== original.href) link.href = resource.href;
            cleanup();
            resolve();
          };
          const failed = () => {
            releaseRequest();
            timer = setTimeout(() => {
              attempt += 1;
              load();
            }, 500);
          };
          const load = () => {
            if (signal?.aborted) return abort();
            resource = new URL(original);
            if (attempt > 0) resource.searchParams.set('style-retry', String(attempt));
            request = native ? link : (link.cloneNode() as HTMLLinkElement);
            if (!native) {
              request.rel = 'preload';
              request.as = 'style';
            }
            request.addEventListener('load', loaded);
            request.addEventListener('error', failed);
            request.href = resource.href;
            if (!native) sourceDocument.head.append(request);
          };
          signal?.addEventListener('abort', abort, { once: true });
          load();
        }),
    ),
  ).then(() => undefined);
}
