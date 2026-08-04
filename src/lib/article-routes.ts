import { getRelativeLocaleUrl } from 'astro:i18n';
import { BASE_LOCALE, type Locale } from '../i18n/config';
import type { Article, ArticleVersion } from './articles';

const routeLocale = (article: Article | string, locale?: Locale) =>
  locale ?? (typeof article === 'string' ? BASE_LOCALE : article.locale);

const articleId = (article: Article | string) =>
  typeof article === 'string' ? article : article.id;

export function getArticleHref(article: Article | string, locale?: Locale): string {
  return getRelativeLocaleUrl(routeLocale(article, locale), `blog/${articleId(article)}/`);
}

export function getArticleVersionHref(
  article: Article | string,
  version: ArticleVersion | number,
  locale?: Locale,
): string {
  const number = typeof version === 'number' ? version : version.number;
  return getRelativeLocaleUrl(
    routeLocale(article, locale),
    `blog/${articleId(article)}/v/${number}/`,
  );
}

export function getArticleCompareHref(
  article: Article | string,
  base: ArticleVersion | number,
  comparison: ArticleVersion | number,
  locale?: Locale,
): string {
  const baseNumber = typeof base === 'number' ? base : base.number;
  const comparisonNumber = typeof comparison === 'number' ? comparison : comparison.number;
  if (baseNumber === comparisonNumber) {
    throw new Error('An article version cannot be compared to itself.');
  }

  const path = getRelativeLocaleUrl(
    routeLocale(article, locale),
    `blog/${articleId(article)}/compare/`,
  );
  const parameters = new URLSearchParams({
    base: String(baseNumber),
    compare: String(comparisonNumber),
  });
  return `${path}?${parameters}`;
}

export function getArticleVersionSourceHref(
  article: Article | string,
  version: ArticleVersion | number,
  locale?: Locale,
): string {
  const number = typeof version === 'number' ? version : version.number;
  return getRelativeLocaleUrl(
    routeLocale(article, locale),
    `blog/${articleId(article)}/compare/data/${number}.json`,
  ).replace(/\/$/, '');
}
