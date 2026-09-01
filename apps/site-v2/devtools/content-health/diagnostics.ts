import { parseArticleEntryId } from '@sshawn9/site-domain/article-convention';
import { LOCALES, type Locale } from '@sshawn9/site-domain/locales';
import type { SiteArticleEntry } from '../../src/content/article-source.ts';
import type { ContentHealthItem, ContentHealthReport } from './contract.ts';

type ArticleVersionGroup = {
  articleId: string;
  version: number;
  entries: SiteArticleEntry[];
};

function routeFor(group: ArticleVersionGroup, locale: Locale, currentVersion: number): string {
  const base = `/${locale}/blog/${group.articleId}`;
  return group.version === currentVersion ? `${base}/` : `${base}/v/${group.version}/`;
}

function localizedTitles(entries: SiteArticleEntry[]): Record<Locale, string> {
  const localized = new Map(
    entries.map((entry) => [parseArticleEntryId(entry.id).contentLocale, entry.data.title]),
  );
  const fallback = localized.get('en') ?? localized.get('zh') ?? 'Untitled article';
  return {
    en: localized.get('en') ?? fallback,
    zh: localized.get('zh') ?? fallback,
  };
}

function toItem(group: ArticleVersionGroup, currentVersion: number): ContentHealthItem {
  const availableLocales = [
    ...new Set(group.entries.map((entry) => parseArticleEntryId(entry.id).contentLocale)),
  ].sort() as Locale[];
  const missingLocales = LOCALES.filter((locale) => !availableLocales.includes(locale));

  return {
    articleId: group.articleId,
    version: group.version,
    currentVersion: group.version === currentVersion,
    titles: localizedTitles(group.entries),
    availableLocales,
    missingLocales,
    routes: {
      en: routeFor(group, 'en', currentVersion),
      zh: routeFor(group, 'zh', currentVersion),
    },
  };
}

export function analyzeArticleEntries(entries: SiteArticleEntry[]): ContentHealthReport {
  const grouped = new Map<string, ArticleVersionGroup>();
  const currentVersionByArticle = new Map<string, number>();

  for (const entry of entries) {
    const { articleId, version } = parseArticleEntryId(entry.id);
    const key = `${articleId}\0${version}`;
    const group = grouped.get(key) ?? { articleId, version, entries: [] };
    group.entries.push(entry);
    grouped.set(key, group);
    currentVersionByArticle.set(
      articleId,
      Math.max(currentVersionByArticle.get(articleId) ?? version, version),
    );
  }

  const versions = [...grouped.values()]
    .map((group) => ({
      group,
      item: toItem(group, currentVersionByArticle.get(group.articleId) ?? group.version),
    }))
    .sort(
      (left, right) =>
        left.group.articleId.localeCompare(right.group.articleId) ||
        right.group.version - left.group.version,
    );

  return {
    drafts: versions
      .filter(({ group }) => group.entries.some((entry) => entry.data.draft))
      .map(({ item }) => item),
    languageGaps: versions
      .filter(({ item }) => item.missingLocales.length > 0)
      .map(({ item }) => item),
  };
}
