import { execFileSync } from 'node:child_process';
import { getCollection, type CollectionEntry } from 'astro:content';
import { SITE_MODE } from 'astro:env/server';
import { BASE_LOCALE, otherLocale, type Locale } from '../i18n/config';
import { parseArticleEntryId } from './article-convention';

type BlogContentEntry = CollectionEntry<'blog'>;
type ArticleMetadataEntry = CollectionEntry<'articleMetadata'>;
export type BlogEntry = Omit<BlogContentEntry, 'data'> & {
  data: BlogContentEntry['data'] & ArticleMetadataEntry['data'];
  sourceLastModifiedAt?: Date;
};

export type ArticleVersion = {
  entry: BlogEntry;
  number: number;
  contentLocale: Locale;
  availableLocales: Locale[];
  hasRequestedLocale: boolean;
};

export type Article = {
  id: string;
  locale: Locale;
  versions: ArticleVersion[];
  current: ArticleVersion;
  isVersioned: boolean;
};

type SourceCandidate = {
  entry: BlogEntry;
  contentLocale: Locale;
  explicitLocale: boolean;
};

const sourceLastModifiedCache = new Map<string, Date | undefined>();
let repositoryHistoryChecked = false;

function assertCompleteGitHistory(): void {
  if (repositoryHistoryChecked) return;

  const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
  if (shallow === 'true') {
    throw new Error(
      'Automatic article update dates require complete Git history. Fetch the repository with depth 0.',
    );
  }
  repositoryHistoryChecked = true;
}

function getSourceLastModifiedAt(filePath: string | undefined): Date | undefined {
  if (!filePath) return undefined;
  if (sourceLastModifiedCache.has(filePath)) return sourceLastModifiedCache.get(filePath);

  assertCompleteGitHistory();
  const timestamp = execFileSync('git', ['log', '-1', '--format=%cI', '--', filePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
  const modifiedAt = timestamp ? new Date(timestamp) : undefined;
  if (modifiedAt && Number.isNaN(modifiedAt.getTime())) {
    throw new Error(`Git returned an invalid update date for ${filePath}: ${timestamp}`);
  }

  sourceLastModifiedCache.set(filePath, modifiedAt);
  return modifiedAt;
}

function selectSource(candidates: SourceCandidate[], locale: Locale): SourceCandidate | undefined {
  const forLocale = (candidateLocale: Locale) =>
    candidates
      .filter((candidate) => candidate.contentLocale === candidateLocale)
      .sort((left, right) => Number(right.explicitLocale) - Number(left.explicitLocale))[0];

  return forLocale(locale) ?? forLocale(otherLocale(locale));
}

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
  const sources = new Map<string, Map<number, SourceCandidate[]>>();

  for (const entry of entries) {
    const parsed = parseArticleEntryId(entry.id);
    const versions = sources.get(parsed.articleId) ?? new Map<number, SourceCandidate[]>();
    const candidates = versions.get(parsed.version) ?? [];
    candidates.push({
      entry,
      contentLocale: parsed.contentLocale,
      explicitLocale: parsed.explicitLocale,
    });
    versions.set(parsed.version, candidates);
    sources.set(parsed.articleId, versions);
  }

  return [...sources.entries()]
    .flatMap(([id, versionSources]): Article[] => {
      const versions = [...versionSources.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([number, candidates]): ArticleVersion[] => {
          const selected = selectSource(candidates, locale);
          if (!selected) return [];

          return [
            {
              entry: selected.entry,
              number,
              contentLocale: selected.contentLocale,
              availableLocales: [
                ...new Set(candidates.map((candidate) => candidate.contentLocale)),
              ],
              hasRequestedLocale: selected.contentLocale === locale,
            },
          ];
        });
      const current = versions.at(-1);
      return current ? [{ id, locale, versions, current, isVersioned: versions.length > 1 }] : [];
    })
    .sort((left, right) => {
      const dateDifference =
        right.versions[0].entry.data.publishedAt.getTime() -
        left.versions[0].entry.data.publishedAt.getTime();
      return dateDifference || left.id.localeCompare(right.id);
    });
}

export async function getVisibleArticles(locale: Locale = BASE_LOCALE): Promise<Article[]> {
  const [contentEntries, metadataEntries] = await Promise.all([
    getCollection('blog'),
    getCollection('articleMetadata'),
  ]);
  const entries = mergeArticleMetadata(contentEntries, metadataEntries).filter(
    ({ data }) => SITE_MODE === 'preview' || !data.draft,
  );
  return resolveArticles(entries, locale);
}

export function getVersionByNumber(
  article: Article,
  versionNumber: number,
): ArticleVersion | undefined {
  return article.versions.find((version) => version.number === versionNumber);
}

export function getVersionDate(version: ArticleVersion): Date {
  return version.entry.data.revisedAt ?? version.entry.data.publishedAt;
}

export function getArticleUpdatedAt(version: ArticleVersion): Date | undefined {
  return version.entry.data.revisedAt ?? version.entry.sourceLastModifiedAt;
}

export function getArticleTags(article: Article): string[] {
  return [...new Set(article.current.entry.data.tags)];
}

export function getArticleProjectIds(article: Article): string[] {
  return [...new Set(article.current.entry.data.projects.map((project) => project.id))];
}
