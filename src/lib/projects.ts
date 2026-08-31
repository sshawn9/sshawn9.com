import { getCollection, getEntries, getEntry, type CollectionEntry } from 'astro:content';
import { getArticlesForProject, resolveProjects } from '@sshawn9/site-domain/projects';
import { localePath, type Locale } from '../i18n/config';
import { getVisibleArticles, type Article } from './articles';

type ProjectEntry = CollectionEntry<'projects'>;
type ProjectMetadataEntry = CollectionEntry<'projectMetadata'>;
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
  return resolveProjects(entries, metadataEntries, locale).map(
    ({ order: _order, preview: _preview, hasBody: _hasBody, ...project }) => ({
      ...project,
      href: localePath(locale, `/projects/${project.id}/`),
    }),
  );
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

  return getArticlesForProject(articles, projectId);
}
