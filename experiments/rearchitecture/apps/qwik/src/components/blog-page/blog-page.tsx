import { component$ } from '@builder.io/qwik';
import { Link } from '@builder.io/qwik-city';
import { listArticles, tags } from '@poc-shared/fixture-data';

interface BlogPageProps {
  activeTag?: string;
}

/** Static blog listing and tag navigation used by direct and client visits. */
export const BlogPage = component$<BlogPageProps>(({ activeTag }) => {
  const articles = activeTag
    ? listArticles.filter((entry) => entry.tags.some((tag) => tag === activeTag))
    : listArticles;
  const repeatedArticles = Array.from({ length: 3 }, () => articles).flat();

  return (
    <div class="blog-layout" data-blog-page>
      <aside class="tag-rail" data-scroll-region="tag-rail" aria-labelledby="tag-heading">
        <h1 id="tag-heading">文章标签</h1>
        <ul class="tag-list">
          {tags.map(([tag, count]) => (
            <li key={tag}>
              <Link
                class="tag-link"
                href={tag === 'Frenet' ? '/zh/blog/tag/frenet/' : '/zh/blog/'}
                prefetch={false}
                aria-current={activeTag === tag ? 'page' : undefined}
              >
                <span>{tag}</span>
                <small>{count}</small>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section aria-labelledby="articles-heading">
        <h1 id="articles-heading">{activeTag ? '#' + activeTag : '全部文章'}</h1>
        <p>共 {repeatedArticles.length} 篇</p>
        <ol class="article-list">
          {repeatedArticles.map((entry, index) => (
            <li class="article-card" key={entry.slug + '-' + String(index)}>
              <div>
                <h2>
                  <Link
                    href={'/zh/blog/frenet-poc/?source=' + entry.slug + '-' + String(index)}
                    prefetch={false}
                    data-article-link={
                      index === 0 ? 'primary' : index === 1 ? 'history' : undefined
                    }
                  >
                    {entry.title}
                  </Link>
                </h2>
                <p>{entry.description}</p>
              </div>
              <div>
                <div class="article-meta">{entry.publishedAt}</div>
                <div class="tag-row">
                  {entry.tags.map((tag) => (
                    <span class="tag-pill" key={tag}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
});
