import type { APIRoute, GetStaticPaths } from 'astro';
import { LOCALES } from '../../../../../../i18n/config';
import { getPublishedArticles, type ArticleVersion } from '../../../../../../lib/articles';

type Props = { version: ArticleVersion };

export const getStaticPaths = (async () => {
  const localizedArticles = await Promise.all(
    LOCALES.map(async (locale) => ({ locale, articles: await getPublishedArticles(locale) })),
  );

  return localizedArticles.flatMap(({ locale, articles }) =>
    articles.flatMap((article) =>
      article.isVersioned
        ? article.versions.map((version) => ({
            params: { locale, id: article.id, version: String(version.number) },
            props: { version },
          }))
        : [],
    ),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(JSON.stringify({ body: props.version.entry.body ?? '' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
