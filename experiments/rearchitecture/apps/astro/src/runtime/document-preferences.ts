/** Copies persistent prepaint preferences into a fetched target document. */
export function prepareTargetDocumentPreferences(targetDocument: Document) {
  for (const key of ['theme', 'wallpaper'] as const) {
    const value = document.documentElement.dataset[key];
    if (value) {
      targetDocument.documentElement.dataset[key] = value;
    } else {
      delete targetDocument.documentElement.dataset[key];
    }
  }
}
