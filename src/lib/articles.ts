import { getCollection, type CollectionEntry } from 'astro:content';
import { SITE_MODE } from 'astro:env/server';
import { createSourceLastModifiedResolver } from '@sshawn9/site-build/git-last-modified';
import {
  getArticleUpdatedAt,
  getArticleVersion,
  getArticleVersionDate,
  getArticleProjectIds as getResolvedArticleProjectIds,
  getArticleTags as getResolvedArticleTags,
  resolveArticles as resolveArticleEntries,
  type ResolvedArticle,
  type ResolvedArticleVersion,
} from '@sshawn9/site-domain/articles';
import { BASE_LOCALE, type Locale } from '../i18n/config';
import { parseArticleEntryId } from './article-convention';

type BlogContentEntry = CollectionEntry<'blog'>;
type ArticleMetadataEntry = CollectionEntry<'articleMetadata'>;
export type BlogEntry = Omit<BlogContentEntry, 'data'> & {
  data: BlogContentEntry['data'] & ArticleMetadataEntry['data'];
  sourceLastModifiedAt?: Date;
};

export type ArticleVersion = ResolvedArticleVersion<BlogEntry>;
export type Article = ResolvedArticle<BlogEntry>;

const getSourceLastModifiedAt = createSourceLastModifiedResolver(process.cwd());

function mergeArticleMetadata(
  entries: BlogContentEntry[],
  metadataEntries: ArticleMetadataEntry[],
): BlogEntry[] {
  const metadataById = new Map(metadataEntries.map((entry) => [entry.id, entry]));

  return entries.map((entry) => {
    const { versionId } = parseArticleEntryId(entry.id);
    const metadata = metadataById.get(versionId);
    if (!metadata) {
      throw new Error(`No article metadata found for “${versionId}”.`);
    }

    return {
      ...entry,
      data: { ...entry.data, ...metadata.data },
      sourceLastModifiedAt: metadata.data.revisedAt
        ? undefined
        : getSourceLastModifiedAt(entry.filePath),
    };
  });
}

export function resolveArticles(entries: BlogEntry[], locale: Locale = BASE_LOCALE): Article[] {
  return resolveArticleEntries(entries, locale);
}

export async function getVisibleArticles(locale: Locale = BASE_LOCALE): Promise<Article[]> {
  const [contentEntries, metadataEntries] = await Promise.all([
    getCollection('blog'),
    getCollection('articleMetadata'),
  ]);
  const entries = mergeArticleMetadata(contentEntries, metadataEntries).filter(
    ({ data }) => import.meta.env.DEV || SITE_MODE === 'preview' || !data.draft,
  );
  return resolveArticles(entries, locale);
}

export function getVersionByNumber(
  article: Article,
  versionNumber: number,
): ArticleVersion | undefined {
  return getArticleVersion(article, versionNumber);
}

export function getVersionDate(version: ArticleVersion): Date {
  return getArticleVersionDate(version);
}

export function getArticleTags(article: Article): string[] {
  return getResolvedArticleTags(article);
}

export function getArticleProjectIds(article: Article): string[] {
  return getResolvedArticleProjectIds(article);
}

export { getArticleUpdatedAt };
