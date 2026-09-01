export const DRAFTS_APP_ID = 'sshawn9:drafts';
export const DRAFTS_DATA_EVENT = `${DRAFTS_APP_ID}:data`;
export const SINGLE_LANGUAGE_APP_ID = 'sshawn9:single-language';
export const SINGLE_LANGUAGE_DATA_EVENT = `${SINGLE_LANGUAGE_APP_ID}:data`;

export type ContentLocale = 'en' | 'zh';

export type ContentHealthItem = {
  articleId: string;
  version: number;
  currentVersion: boolean;
  titles: Record<ContentLocale, string>;
  availableLocales: ContentLocale[];
  missingLocales: ContentLocale[];
  routes: Record<ContentLocale, string>;
};

export type ContentHealthReport = {
  drafts: ContentHealthItem[];
  languageGaps: ContentHealthItem[];
};

export type ContentHealthMessage =
  { status: 'ready'; report: ContentHealthReport } | { status: 'error'; message: string };
