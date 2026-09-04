import { createContentListApp } from './app.ts';
import { DRAFTS_DATA_EVENT } from './contract.ts';

export default createContentListApp({
  title: 'Drafts',
  ariaLabel: 'Draft articles',
  dataEvent: DRAFTS_DATA_EVENT,
  emptyMessage: 'No draft articles.',
  items: ({ drafts }) => drafts,
});
