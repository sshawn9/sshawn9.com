import { getCollection, type CollectionEntry } from 'astro:content';
import { BASE_LOCALE, localePath, otherLocale, type Locale } from '../i18n/config';

type ProjectEntry = CollectionEntry<'projects'>;
type Candidate = {
  entry: ProjectEntry;
  locale: Locale;
  explicitLocale: boolean;
};

const PROJECT_ENTRY_ID = /^([^/]+)\/index(?:\.(en|zh))?$/;

export type Project = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  tags: string[];
  href: string;
  external: boolean;
  accent: 'cyan' | 'violet' | 'amber';
};

export async function getProjects(locale: Locale): Promise<Project[]> {
  const entries = await getCollection('projects');
  const projects = new Map<string, Candidate[]>();

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

  return [...projects.entries()]
    .map(([id, candidates]) => {
      const forLocale = (target: Locale) =>
        candidates
          .filter((candidate) => candidate.locale === target)
          .sort((left, right) => Number(right.explicitLocale) - Number(left.explicitLocale))[0];
      const selected = forLocale(locale) ?? forLocale(otherLocale(locale));
      if (!selected) throw new Error(`No content source found for project “${id}”.`);

      return {
        id,
        ...selected.entry.data,
        href: selected.entry.data.href ?? `${localePath(locale, '/projects/')}#${id}`,
      };
    })
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...project }) => project);
}
