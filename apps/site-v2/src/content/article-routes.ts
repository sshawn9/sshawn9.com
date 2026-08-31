import type { Locale } from '@sshawn9/site-domain/locales';
import type { SiteArticle, SiteArticleEntry } from './article-catalog';
import type { ResolvedArticleVersion } from '@sshawn9/site-domain/articles';

type ArticleIdentity = Pick<SiteArticle, 'id' | 'locale'> | string;
type VersionIdentity = ResolvedArticleVersion<SiteArticleEntry> | number;

function articleId(article: ArticleIdentity): string {
  return typeof article === 'string' ? article : article.id;
}

function articleLocale(article: ArticleIdentity, locale?: Locale): Locale {
  if (locale) return locale;
  return typeof article === 'string' ? 'en' : article.locale;
}

function versionNumber(version: VersionIdentity): number {
  return typeof version === 'number' ? version : version.number;
}

export function getArticleHref(article: ArticleIdentity, locale?: Locale): string {
  return `/${articleLocale(article, locale)}/blog/${articleId(article)}/`;
}

export function getArticleVersionHref(
  article: ArticleIdentity,
  version: VersionIdentity,
  locale?: Locale,
): string {
  return `/${articleLocale(article, locale)}/blog/${articleId(article)}/v/${versionNumber(version)}/`;
}

export function getArticleCompareHref(
  article: ArticleIdentity,
  base: VersionIdentity,
  comparison: VersionIdentity,
  locale?: Locale,
): string {
  const baseNumber = versionNumber(base);
  const comparisonNumber = versionNumber(comparison);
  if (baseNumber === comparisonNumber) {
    throw new Error('An article version cannot be compared to itself.');
  }

  const query = new URLSearchParams({
    base: String(baseNumber),
    compare: String(comparisonNumber),
  });
  return `/${articleLocale(article, locale)}/blog/${articleId(article)}/compare/?${query}`;
}

export function getArticleVersionSourceHref(
  article: ArticleIdentity,
  version: VersionIdentity,
  locale?: Locale,
): string {
  return `/${articleLocale(article, locale)}/blog/${articleId(article)}/compare/data/${versionNumber(version)}.json`;
}
