import type { APIRoute, GetStaticPaths } from 'astro';
import type { ResolvedArticleVersion } from '@sshawn9/site-domain/articles';
import { LOCALES, type Locale } from '@sshawn9/site-domain/locales';
import {
  getVisibleArticles,
  type SiteArticleEntry,
} from '../../../../../../content/article-catalog';

interface Props {
  locale: Locale;
  version: ResolvedArticleVersion<SiteArticleEntry>;
}

export const getStaticPaths = (async () => {
  const localizedArticles = await Promise.all(
    LOCALES.map(async (locale) => ({ locale, articles: await getVisibleArticles(locale) })),
  );

  return localizedArticles.flatMap(({ locale, articles }) =>
    articles.flatMap((article) =>
      article.isVersioned
        ? article.versions.map((version) => ({
            params: { locale, id: article.id, version: String(version.number) },
            props: { locale, version },
          }))
        : [],
    ),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(JSON.stringify({ body: props.version.entry.body ?? '' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
