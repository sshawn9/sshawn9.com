import type { Page } from '@playwright/test';
import { parseHTML } from 'linkedom';

const commonTags = ['common-1', 'common-2', 'common-3', 'common-4'];
const articles = [
  { id: 'alpha-only', tags: ['alpha'] },
  { id: 'beta-only', tags: ['beta'] },
  { id: 'shared', tags: ['alpha', 'beta'] },
  { id: 'alpha-second', tags: ['alpha'] },
  { id: 'beta-second', tags: ['beta'] },
  { id: 'beta-third', tags: ['beta'] },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `other-${index + 1}`,
    tags: [`other-${index + 1}`],
  })),
].map((article) => ({ ...article, tags: [...commonTags, ...article.tags] }));

// Counts put Beta before Alpha. Extra tags make the sidebar independently scrollable.
const tags = [...commonTags, 'beta', 'alpha', ...articles.slice(6).map(({ id }) => id)];

/** Supply catalog markup before the real blog runtime initializes, even for an empty site. */
export async function installBlogFixture(page: Page) {
  await page.route(/\/en\/blog\/(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const { document } = parseHTML(await response.text());
    const listing = document.querySelector('[data-blog-listing]')!;
    const results = listing.querySelector('[data-blog-results]')!;
    results.querySelector('.blog-article-list')!.innerHTML = articles
      .map(
        ({ id, tags }) => `
          <li data-blog-article
              data-article-tag-slugs='${JSON.stringify(tags)}'>
            <article class="blog-article" lang="en">
              <div class="blog-article-copy">
                <h2><a href="/en/about/">Fixture ${id}</a></h2>
                <p>A controlled article for blog navigation tests.</p>
              </div>
              <footer class="blog-article-meta"><ul aria-label="Article tags">
                ${tags
                  .map(
                    (tag) => `<li><a class="blog-article-tag" href="/en/tags/${tag}/"
                      data-blog-filter-link data-tag-slug="${tag}">#${tag}
                      <span class="sr-only" data-blog-selected-copy hidden>Selected</span>
                    </a></li>`,
                  )
                  .join('')}
              </ul></footer>
            </article>
          </li>`,
      )
      .join('');

    const layout = document.createElement('div');
    layout.className = 'blog-layout';
    layout.setAttribute('data-blog-sidebar-layout', '');
    layout.innerHTML = `
      <div class="blog-sidebar-shell" data-blog-sidebar-shell>
        <button class="blog-sidebar-toggle" data-blog-sidebar-toggle disabled
          data-blog-sidebar-collapse data-collapse-label="Collapse tags" data-expand-label="Expand tags"
          aria-label="Collapse tags" aria-controls="blog-sidebar" aria-expanded="true"></button>
        <div class="blog-sidebar-viewport" data-blog-sidebar-viewport>
          <aside id="blog-sidebar" class="blog-sidebar" data-blog-sidebar-panel aria-labelledby="blog-sidebar-title">
            <header class="blog-sidebar-header"><h2 id="blog-sidebar-title">Article tags</h2></header>
            <section class="blog-tag-module" data-blog-sidebar-section="article-tags">
              <button class="blog-mobile-tag-toggle" data-blog-mobile-toggle disabled
                aria-controls="blog-tag-panel" aria-expanded="true">Article tags</button>
              <div id="blog-tag-panel" class="blog-tag-panel" data-blog-mobile-panel data-scroll-region="blog-sidebar-tags">
                <ul class="blog-tag-directory" aria-label="Article tags">
                  ${tags
                    .map((tag) => {
                      const count = articles.filter(({ tags }) => tags.includes(tag)).length;
                      return `<li><a href="/en/tags/${tag}/" class="blog-tag-filter"
                        data-blog-tag-definition data-blog-filter-link data-tag-name="${tag}"
                        data-tag-slug="${tag}" data-tag-count="${count}">
                        <span class="blog-tag-name">${tag}</span><span class="blog-tag-count">${count}</span>
                        <span class="sr-only" data-blog-selected-copy hidden>Selected</span>
                      </a></li>`;
                    })
                    .join('')}
                </ul>
              </div>
            </section>
          </aside>
        </div>
        <div class="blog-sidebar-rail"><div role="separator" data-blog-sidebar-resizer
          aria-label="Resize tags" aria-controls="blog-sidebar" aria-orientation="vertical"
          aria-valuemin="208" aria-valuemax="400" aria-valuenow="272" tabindex="-1" aria-disabled="true">
          <span data-blog-sidebar-boundary></span>
        </div></div>
      </div>
      <div class="blog-results-column"></div>`;
    (listing.querySelector('[data-blog-sidebar-layout]') ?? results).replaceWith(layout);
    layout.querySelector('.blog-results-column')!.append(results);
    await route.fulfill({ response, body: document.toString() });
  });
}
