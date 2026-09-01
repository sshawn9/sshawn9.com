import { createContentListApp } from './app.ts';
import { SINGLE_LANGUAGE_DATA_EVENT } from './contract.ts';

export default createContentListApp({
  title: 'Single-language Articles',
  ariaLabel: 'Single-language articles',
  dataEvent: SINGLE_LANGUAGE_DATA_EVENT,
  emptyMessage: 'Every article version is available in both languages.',
  items: ({ languageGaps }) => languageGaps,
  showMissingLocales: true,
});
