import { slug as createSlug } from 'github-slugger';
import type { Locale } from '../i18n/config';
import { localePath } from '../i18n/config';
import { getArticleTags, type Article } from './articles';

export type TagDefinition = {
  name: string;
  slug: string;
  count: number;
};

// Add an entry here only when a published tag needs a permanent slug that
// differs from the generated default, for example ['C++', 'cpp'].
const TAG_SLUG_OVERRIDES: ReadonlyMap<string, string> = new Map();

export function getTagSlug(name: string): string {
  const normalizedName = name.trim();
  const tagSlug = TAG_SLUG_OVERRIDES.get(normalizedName) ?? createSlug(normalizedName);
  if (!tagSlug) throw new Error(`Tag “${name}” does not produce a valid URL slug.`);
  return tagSlug;
}

export function getTagHref(name: string, locale: Locale): string {
  return localePath(locale, `/tags/${getTagSlug(name)}/`);
}

export function getTagDefinitions(articles: Article[]): TagDefinition[] {
  const counts = new Map<string, number>();
  for (const article of articles) {
    for (const tag of getArticleTags(article)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const namesBySlug = new Map<string, string>();
  const definitions = [...counts].map(([name, count]) => {
    const slug = getTagSlug(name);
    const existingName = namesBySlug.get(slug);
    if (existingName && existingName !== name) {
      throw new Error(
        `Tags “${existingName}” and “${name}” resolve to the same slug “${slug}”. Add an explicit override.`,
      );
    }
    namesBySlug.set(slug, name);
    return { name, slug, count };
  });

  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return definitions.sort(
    (left, right) => right.count - left.count || collator.compare(left.name, right.name),
  );
}

export function getArticlesForTag(articles: Article[], tagName: string): Article[] {
  return articles.filter((article) => getArticleTags(article).includes(tagName));
}
