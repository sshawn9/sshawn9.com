import { getCollection, type CollectionEntry } from 'astro:content';
import { BASE_LOCALE, otherLocale, type Locale } from '../i18n/config';

export type BlogEntry = CollectionEntry<'blog'>;
export type ArticleContentTag = BlogEntry['data']['tags'][number];

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

type ParsedEntryId = {
  articleId: string;
  version: number;
  contentLocale: Locale;
  explicitLocale: boolean;
};

type SourceCandidate = {
  entry: BlogEntry;
  contentLocale: Locale;
  explicitLocale: boolean;
};

const VERSION_DIRECTORY = /^v([1-9]\d*)$/;
const LOCALIZED_INDEX_ID = /^index\.?(en|zh)$/;

function parseEntryId(id: string): ParsedEntryId {
  const segments = id.split('/');
  const explicitFileMatch = segments.at(-1)?.match(LOCALIZED_INDEX_ID);
  const indexFileMatch = segments.at(-1) === 'index';

  if (explicitFileMatch || indexFileMatch) segments.pop();
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
    version: versionMatch ? Number(versionMatch[1]) : 1,
    contentLocale: explicitFileMatch?.[1] === 'zh' ? 'zh' : BASE_LOCALE,
    explicitLocale: Boolean(explicitFileMatch?.[1]),
  };
}

function selectSource(candidates: SourceCandidate[], locale: Locale): SourceCandidate | undefined {
  const forLocale = (candidateLocale: Locale) =>
    candidates
      .filter((candidate) => candidate.contentLocale === candidateLocale)
      .sort((left, right) => Number(right.explicitLocale) - Number(left.explicitLocale))[0];

  return forLocale(locale) ?? forLocale(otherLocale(locale));
}

export async function getPublishedArticles(locale: Locale = BASE_LOCALE): Promise<Article[]> {
  const entries = await getCollection('blog', ({ data }) => !data.draft);
  const sources = new Map<string, Map<number, SourceCandidate[]>>();

  for (const entry of entries) {
    const parsed = parseEntryId(entry.id);
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

export function getVersionByNumber(
  article: Article,
  versionNumber: number,
): ArticleVersion | undefined {
  return article.versions.find((version) => version.number === versionNumber);
}

export function getVersionDate(version: ArticleVersion): Date {
  return version.entry.data.revisedAt ?? version.entry.data.publishedAt;
}

export function getTagName(tag: ArticleContentTag): string {
  return typeof tag === 'string' ? tag : tag.label;
}
