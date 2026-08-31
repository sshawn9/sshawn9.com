import { parseArticleEntryId } from './article-convention';
import { BASE_LOCALE, otherLocale, type Locale } from './locales';

export type ResolvableArticleEntry = {
  id: string;
  data: {
    publishedAt: Date;
    revisedAt?: Date;
    tags: string[];
    projects: Array<{ id: string }>;
    draft: boolean;
  };
  sourceLastModifiedAt?: Date;
};

export type ResolvedArticleVersion<Entry extends ResolvableArticleEntry> = {
  entry: Entry;
  number: number;
  contentLocale: Locale;
  availableLocales: Locale[];
  hasRequestedLocale: boolean;
};

export type ResolvedArticle<Entry extends ResolvableArticleEntry> = {
  id: string;
  locale: Locale;
  versions: Array<ResolvedArticleVersion<Entry>>;
  current: ResolvedArticleVersion<Entry>;
  isVersioned: boolean;
};

type SourceCandidate<Entry extends ResolvableArticleEntry> = {
  entry: Entry;
  contentLocale: Locale;
  explicitLocale: boolean;
};

function selectSource<Entry extends ResolvableArticleEntry>(
  candidates: Array<SourceCandidate<Entry>>,
  locale: Locale,
): SourceCandidate<Entry> | undefined {
  const forLocale = (candidateLocale: Locale) =>
    candidates
      .filter((candidate) => candidate.contentLocale === candidateLocale)
      .sort((left, right) => Number(right.explicitLocale) - Number(left.explicitLocale))[0];

  return forLocale(locale) ?? forLocale(otherLocale(locale));
}

export function resolveArticles<Entry extends ResolvableArticleEntry>(
  entries: Entry[],
  locale: Locale = BASE_LOCALE,
): Array<ResolvedArticle<Entry>> {
  const sources = new Map<string, Map<number, Array<SourceCandidate<Entry>>>>();

  for (const entry of entries) {
    const parsed = parseArticleEntryId(entry.id);
    const versions =
      sources.get(parsed.articleId) ?? new Map<number, Array<SourceCandidate<Entry>>>();
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
    .flatMap(([id, versionSources]): Array<ResolvedArticle<Entry>> => {
      const versions = [...versionSources.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([number, candidates]): Array<ResolvedArticleVersion<Entry>> => {
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

export function getArticleTags<Entry extends ResolvableArticleEntry>(
  article: ResolvedArticle<Entry>,
): string[] {
  return [...new Set(article.current.entry.data.tags)];
}

export function getArticleProjectIds<Entry extends ResolvableArticleEntry>(
  article: ResolvedArticle<Entry>,
): string[] {
  return [...new Set(article.current.entry.data.projects.map((project) => project.id))];
}

export function getArticleVersion<Entry extends ResolvableArticleEntry>(
  article: ResolvedArticle<Entry>,
  versionNumber: number,
): ResolvedArticleVersion<Entry> | undefined {
  return article.versions.find((version) => version.number === versionNumber);
}

/** Date that identifies a public version in the version picker. */
export function getArticleVersionDate<Entry extends ResolvableArticleEntry>(
  version: ResolvedArticleVersion<Entry>,
): Date {
  return version.entry.data.revisedAt ?? version.entry.data.publishedAt;
}

/** Last change visible in the selected language file of a public version. */
export function getArticleUpdatedAt<Entry extends ResolvableArticleEntry>(
  version: ResolvedArticleVersion<Entry>,
): Date | undefined {
  return version.entry.data.revisedAt ?? version.entry.sourceLastModifiedAt;
}
