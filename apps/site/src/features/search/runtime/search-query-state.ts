export const SEARCH_QUERY_PARAMETER = 'q';

export function normalizeSearchQuery(query: string): string {
  return query.trim();
}

export function readSearchQuery(url: URL): string {
  return normalizeSearchQuery(url.searchParams.get(SEARCH_QUERY_PARAMETER) ?? '');
}

export function createSearchQueryUrl(currentUrl: URL, query: string): URL {
  const nextUrl = new URL(currentUrl);
  const normalizedQuery = normalizeSearchQuery(query);
  if (normalizedQuery) nextUrl.searchParams.set(SEARCH_QUERY_PARAMETER, normalizedQuery);
  else nextUrl.searchParams.delete(SEARCH_QUERY_PARAMETER);
  return nextUrl;
}
