import {
  getArticleProjectIds,
  type ResolvableArticleEntry,
  type ResolvedArticle,
} from './articles';
import { BASE_LOCALE, otherLocale, type Locale } from './locales';

export const PROJECT_PREVIEW_KINDS = ['motion-control'] as const;

export type ProjectPreviewKind = (typeof PROJECT_PREVIEW_KINDS)[number];

export type ResolvableProjectEntry = {
  id: string;
  body?: string;
  data: {
    title: string;
    description: string;
    tags: string[];
  };
};

export type ProjectMetadataEntry = {
  id: string;
  data: {
    order: number;
    preview?: ProjectPreviewKind;
  };
};

export type ResolvedProject<Entry extends ResolvableProjectEntry> = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  order: number;
  preview?: ProjectPreviewKind;
  contentLocale: Locale;
  hasBody: boolean;
  entry: Entry;
};

type ProjectSource<Entry extends ResolvableProjectEntry> = {
  entry: Entry;
  contentLocale: Locale;
  explicitLocale: boolean;
};

const PROJECT_ENTRY_ID = /^([^/]+)\/index(?:\.(en|zh))?$/;

function selectProjectSource<Entry extends ResolvableProjectEntry>(
  sources: Array<ProjectSource<Entry>>,
  locale: Locale,
): ProjectSource<Entry> | undefined {
  const forLocale = (candidateLocale: Locale) =>
    sources
      .filter((source) => source.contentLocale === candidateLocale)
      .sort((left, right) => Number(right.explicitLocale) - Number(left.explicitLocale))[0];

  return forLocale(locale) ?? forLocale(otherLocale(locale));
}

export function resolveProjects<
  Entry extends ResolvableProjectEntry,
  Metadata extends ProjectMetadataEntry,
>(
  entries: Entry[],
  metadataEntries: Metadata[],
  locale: Locale = BASE_LOCALE,
): Array<ResolvedProject<Entry>> {
  const sourcesByProject = new Map<string, Array<ProjectSource<Entry>>>();
  const metadataById = new Map(metadataEntries.map((entry) => [entry.id, entry]));

  for (const entry of entries) {
    const match = entry.id.match(PROJECT_ENTRY_ID);
    const projectId = match?.[1];
    if (!projectId) {
      throw new Error(`Invalid project path “${entry.id}”. Use project/index[.locale].md.`);
    }

    const sources = sourcesByProject.get(projectId) ?? [];
    sources.push({
      entry,
      contentLocale: match[2] === 'zh' ? 'zh' : BASE_LOCALE,
      explicitLocale: Boolean(match[2]),
    });
    sourcesByProject.set(projectId, sources);
  }

  for (const metadata of metadataEntries) {
    if (!sourcesByProject.has(metadata.id)) {
      throw new Error(`No localized project content found for “${metadata.id}”.`);
    }
  }

  return [...sourcesByProject.entries()]
    .map(([id, sources]) => {
      const metadata = metadataById.get(id);
      if (!metadata) throw new Error(`No project metadata found for “${id}”.`);

      const selected = selectProjectSource(sources, locale);
      if (!selected) throw new Error(`No content source found for project “${id}”.`);

      return {
        id,
        title: selected.entry.data.title,
        description: selected.entry.data.description,
        tags: selected.entry.data.tags,
        order: metadata.data.order,
        preview: metadata.data.preview,
        contentLocale: selected.contentLocale,
        hasBody: Boolean(selected.entry.body?.trim()),
        entry: selected.entry,
      };
    })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function getArticlesForProject<Entry extends ResolvableArticleEntry>(
  articles: Array<ResolvedArticle<Entry>>,
  projectId: string,
): Array<ResolvedArticle<Entry>> {
  return articles.filter((article) => getArticleProjectIds(article).includes(projectId));
}
