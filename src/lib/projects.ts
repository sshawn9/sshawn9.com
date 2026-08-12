import { getCollection, getEntries, getEntry, type CollectionEntry } from 'astro:content';
import { BASE_LOCALE, localePath, otherLocale, type Locale } from '../i18n/config';
import { getArticleProjectIds, getVisibleArticles, type Article } from './articles';

type ProjectEntry = CollectionEntry<'projects'>;
type ProjectMetadataEntry = CollectionEntry<'projectMetadata'>;
type Candidate = {
  entry: ProjectEntry;
  locale: Locale;
  explicitLocale: boolean;
};

const PROJECT_ENTRY_ID = /^([^/]+)\/index(?:\.(en|zh))?$/;

export type Project = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  href: string;
  contentLocale: Locale;
  entry: ProjectEntry;
};

export async function getProjects(locale: Locale): Promise<Project[]> {
  const [entries, metadataEntries] = await Promise.all([
    getCollection('projects'),
    getCollection('projectMetadata'),
  ]);
  const projects = new Map<string, Candidate[]>();
  const metadataById = new Map(metadataEntries.map((entry) => [entry.id, entry]));

  for (const entry of entries) {
    const match = entry.id.match(PROJECT_ENTRY_ID);
    if (!match?.[1]) {
      throw new Error(`Invalid project path “${entry.id}”. Use project/index[.locale].md.`);
    }

    const candidates = projects.get(match[1]) ?? [];
    candidates.push({
      entry,
      locale: match[2] === 'zh' ? 'zh' : BASE_LOCALE,
      explicitLocale: Boolean(match[2]),
    });
    projects.set(match[1], candidates);
  }

  for (const metadata of metadataEntries) {
    if (!projects.has(metadata.id)) {
      throw new Error(`No localized project content found for “${metadata.id}”.`);
    }
  }

  return [...projects.entries()]
    .map(([id, candidates]) => {
      const metadata = metadataById.get(id);
      if (!metadata) throw new Error(`No project metadata found for “${id}”.`);

      const forLocale = (target: Locale) =>
        candidates
          .filter((candidate) => candidate.locale === target)
          .sort((left, right) => Number(right.explicitLocale) - Number(left.explicitLocale))[0];
      const selected = forLocale(locale) ?? forLocale(otherLocale(locale));
      if (!selected) throw new Error(`No content source found for project “${id}”.`);

      return {
        id,
        title: selected.entry.data.title,
        description: selected.entry.data.description,
        tags: selected.entry.data.tags,
        order: metadata.data.order,
        href: localePath(locale, `/projects/${id}/`),
        contentLocale: selected.locale,
        entry: selected.entry,
      };
    })
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...project }) => project);
}

export async function getProjectArticles(projectId: string, locale: Locale): Promise<Article[]> {
  const [project, articles] = await Promise.all([
    getEntry('projectMetadata', projectId),
    getVisibleArticles(locale),
  ]);
  if (!project) throw new Error(`Unknown project “${projectId}”.`);

  const references = articles.flatMap((article) => article.current.entry.data.projects);
  if (references.length > 0) {
    const resolved = (await getEntries(references)) as Array<ProjectMetadataEntry | undefined>;
    const missingIndex = resolved.findIndex((entry) => !entry);
    if (missingIndex >= 0) {
      throw new Error(`Unknown project reference “${references[missingIndex].id}”.`);
    }
  }

  return articles.filter((article) => getArticleProjectIds(article).includes(projectId));
}
