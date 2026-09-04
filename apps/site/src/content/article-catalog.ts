import { resolveArticles, type ResolvedArticle } from '@sshawn9/site-domain/articles';
import type { Locale } from '@sshawn9/site-domain/locales';
import { SITE_CONTEXT } from '../config/site-context';
import { loadArticleEntries, type SiteArticleEntry } from './article-source';

export type { SiteArticleEntry } from './article-source';

export type SiteArticle = ResolvedArticle<SiteArticleEntry>;

export async function getVisibleArticles(locale: Locale): Promise<SiteArticle[]> {
  const entries = (await loadArticleEntries()).filter(
    ({ data }) => SITE_CONTEXT.includeDraftArticles || !data.draft,
  );
  return resolveArticles(entries, locale);
}
