type FakeElement = { dataset: Record<string, string> };

export function createBlogListing(options: {
  filterable?: boolean;
  tags: Array<{ name: string; slug: string }>;
  articleTags: string[][];
}): HTMLElement {
  const tags = options.tags.map(({ name, slug }) => ({
    dataset: { tagName: name, tagSlug: slug },
  }));
  const articles = options.articleTags.map((tagSlugs) => ({
    dataset: { articleTagSlugs: JSON.stringify(tagSlugs) },
  }));
  return {
    dataset: { blogFilterable: String(options.filterable !== false) },
    querySelectorAll(selector: string): FakeElement[] {
      if (selector === '[data-blog-tag-definition]') return tags;
      if (selector === '[data-blog-article]') return articles;
      return [];
    },
  } as unknown as HTMLElement;
}
