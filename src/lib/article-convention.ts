import { BASE_LOCALE, type Locale } from '../i18n/config';

export type ParsedArticleEntryId = {
  articleId: string;
  versionId: string;
  version: number;
  contentLocale: Locale;
  explicitLocale: boolean;
};

const VERSION_DIRECTORY = /^v([1-9]\d*)$/;
const LOCALIZED_INDEX_ID = /^index(?:\.(en|zh))?$/;

export function parseArticleEntryId(id: string): ParsedArticleEntryId {
  const segments = id.split('/');
  const indexFileMatch = segments.at(-1)?.match(LOCALIZED_INDEX_ID);

  if (indexFileMatch) segments.pop();
  if (segments.length !== 1 && segments.length !== 2) {
    throw new Error(
      `Invalid article path “${id}”. Use article/index[.locale].md or article/vN/index[.locale].md.`,
    );
  }

  const articleId = segments[0];
  const versionMatch = segments[1]?.match(VERSION_DIRECTORY);
  if (!articleId || (segments.length === 2 && !versionMatch)) {
    throw new Error(`Invalid article path “${id}”. Version directories must be named v1, v2, …`);
  }

  return {
    articleId,
    versionId: versionMatch ? `${articleId}/v${versionMatch[1]}` : articleId,
    version: versionMatch ? Number(versionMatch[1]) : 1,
    contentLocale: indexFileMatch?.[1] === 'zh' ? 'zh' : BASE_LOCALE,
    explicitLocale: Boolean(indexFileMatch?.[1]),
  };
}
