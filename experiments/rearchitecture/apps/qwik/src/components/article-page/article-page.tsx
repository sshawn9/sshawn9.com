import { component$, Slot } from '@builder.io/qwik';
import { Link } from '@builder.io/qwik-city';

interface Article {
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  tags: readonly string[];
}

interface TocEntry {
  id: string;
  title: string;
}

interface ArticlePageProps {
  article: Article;
  toc: TocEntry[];
}

/** Provides article chrome while keeping the generated body static. */
export const ArticlePage = component$<ArticlePageProps>(({ article, toc }) => (
  <div class="article-layout" data-article-page>
    <article class="article-body">
      <header class="article-header">
        <Link href="/zh/blog/">博客</Link>
        <h1>{article.title}</h1>
        <p class="article-lede">{article.description}</p>
        <div class="tag-row">
          {article.tags.map((tag) => (
            <span class="tag-pill" key={tag}>
              #{tag}
            </span>
          ))}
        </div>
      </header>
      <Slot />
    </article>
    <aside class="article-toc" data-scroll-region="article-toc" aria-labelledby="toc-heading">
      <h2 id="toc-heading">本文目录</h2>
      <p class="article-meta">
        首次发布 {article.publishedAt}
        <br />
        最后更新 {article.updatedAt}
      </p>
      <ol>
        {toc.map((entry) => (
          <li key={entry.id}>
            <a href={'#' + entry.id}>{entry.title}</a>
          </li>
        ))}
      </ol>
    </aside>
  </div>
));
