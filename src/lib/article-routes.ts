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
  from: ArticleVersion | number,
  to: ArticleVersion | number,
  locale?: Locale,
): string {
  const fromNumber = typeof from === 'number' ? from : from.number;
  const toNumber = typeof to === 'number' ? to : to.number;
  if (fromNumber === toNumber) throw new Error('An article version cannot be compared to itself.');

  const [older, newer] = [fromNumber, toNumber].sort((left, right) => left - right);
  return getRelativeLocaleUrl(
    routeLocale(article, locale),
    `blog/${articleId(article)}/compare/${older}...${newer}/`,
  );
}
