import { expect, test } from 'vitest';
import { getDisplaySubResults } from '../../../apps/site/src/features/search/runtime/pagefind-client';

test('section links omit the main page and retain the strongest matches in document order', () => {
  const section = (url: string, hits: number) => ({
    url,
    title: url,
    excerpt: '',
    locations: Array.from({ length: hits }, (_, i) => i),
  });
  const sections = [
    section('/canonical', 10),
    section('/canonical#a', 1),
    section('/canonical#b', 5),
    section('/canonical#c', 3),
    section('/canonical#d', 4),
  ];
  expect(
    getDisplaySubResults({
      url: '/original',
      meta: { url: '/canonical' },
      excerpt: '',
      sub_results: sections,
    }).map((item) => item.url),
  ).toEqual(['/canonical#b', '/canonical#c', '/canonical#d']);
  expect(getDisplaySubResults({ url: '/', meta: {}, excerpt: '' })).toEqual([]);
  expect(sections[0]?.url).toBe('/canonical');
});
