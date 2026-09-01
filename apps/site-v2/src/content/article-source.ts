import { getCollection, type CollectionEntry } from 'astro:content';
import { createSourceLastModifiedResolver } from '@sshawn9/site-build/git-last-modified';
import { parseArticleEntryId } from '@sshawn9/site-domain/article-convention';

type ContentEntry = CollectionEntry<'blog'>;
type MetadataEntry = CollectionEntry<'articleMetadata'>;

export type SiteArticleEntry = Omit<ContentEntry, 'data'> & {
  data: ContentEntry['data'] & MetadataEntry['data'];
  sourceLastModifiedAt?: Date;
};

const getSourceLastModifiedAt = createSourceLastModifiedResolver(process.cwd());

function mergeMetadata(
  contentEntries: ContentEntry[],
  metadataEntries: MetadataEntry[],
): SiteArticleEntry[] {
  const metadataById = new Map(metadataEntries.map((entry) => [entry.id, entry.data]));

  return contentEntries.map((entry) => {
    const { versionId } = parseArticleEntryId(entry.id);
    const metadata = metadataById.get(versionId);
    if (!metadata) throw new Error(`No article metadata found for “${versionId}”.`);

    const sourceLastModifiedAt = metadata.revisedAt
      ? undefined
      : getSourceLastModifiedAt(entry.filePath);
    return {
      ...entry,
      data: { ...entry.data, ...metadata },
      sourceLastModifiedAt,
    };
  });
}

/** Loads every article source before deployment visibility and locale fallback are applied. */
export async function loadArticleEntries(): Promise<SiteArticleEntry[]> {
  const [contentEntries, metadataEntries] = await Promise.all([
    getCollection('blog'),
    getCollection('articleMetadata'),
  ]);
  return mergeMetadata(contentEntries, metadataEntries);
}
