import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '@sshawn9/site-domain/locales';
import {
  getArticlesForProject,
  resolveProjects,
  type ResolvedProject,
} from '@sshawn9/site-domain/projects';
import { getVisibleArticles, type SiteArticle } from './article-catalog';

type ProjectEntry = CollectionEntry<'projects'>;

export type SiteProject = ResolvedProject<ProjectEntry> & {
  locale: Locale;
  href: string;
};

export type ProjectPageData = {
  project: SiteProject;
  relatedArticles: SiteArticle[];
};

export function getProjectHref(projectId: string, locale: Locale): string {
  return `/${locale}/projects/${projectId}/`;
}

export async function getProjects(locale: Locale): Promise<SiteProject[]> {
  const [contentEntries, metadataEntries] = await Promise.all([
    getCollection('projects'),
    getCollection('projectMetadata'),
  ]);

  return resolveProjects(contentEntries, metadataEntries, locale).map((project) => ({
    ...project,
    locale,
    href: getProjectHref(project.id, locale),
  }));
}

export async function getProjectPages(locale: Locale): Promise<ProjectPageData[]> {
  const [projects, articles] = await Promise.all([getProjects(locale), getVisibleArticles(locale)]);
  const knownProjectIds = new Set(projects.map((project) => project.id));

  for (const article of articles) {
    for (const reference of article.current.entry.data.projects) {
      if (!knownProjectIds.has(reference.id)) {
        throw new Error(`Unknown project reference “${reference.id}” in article “${article.id}”.`);
      }
    }
  }

  return projects.map((project) => ({
    project,
    relatedArticles: getArticlesForProject(articles, project.id),
  }));
}
