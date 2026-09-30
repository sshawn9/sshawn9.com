export const INITIAL_DOCUMENT_CONTENT_ID = 'initial-document-content';
export const INITIAL_DOCUMENT_READY_EVENT = 'site:initial-document-ready';

export function readInitialDocumentContent(sourceDocument: Document): HTMLTemplateElement | null {
  return sourceDocument.querySelector<HTMLTemplateElement>(
    `template#${INITIAL_DOCUMENT_CONTENT_ID}`,
  );
}

/** Move the prepared nodes once; client navigation calls this on a detached document. */
export function mountInitialDocumentContent(sourceDocument: Document): void {
  const template = readInitialDocumentContent(sourceDocument);
  if (template) template.replaceWith(template.content);
}
