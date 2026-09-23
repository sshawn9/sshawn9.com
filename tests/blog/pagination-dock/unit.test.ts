import { expect, test } from 'vitest';
import { revealBlogHeading } from '../../../apps/site/src/features/blog/runtime/blog-pagination-layout';

test('visible headings, including subpixel boundaries, leave the reading position unchanged', () => {
  expect(revealBlogHeading(169, 73, 800, 0)).toBeUndefined();
  expect(revealBlogHeading(90, 73, 800, 79)).toBeUndefined();
  expect(revealBlogHeading(72.7, 73, 800, 96.3)).toBeUndefined();
});

test('headings outside the readable area are revealed in either scroll direction', () => {
  expect(revealBlogHeading(-331, 73, 800, 500)).toBe(96);
  expect(revealBlogHeading(900, 73, 600, 0)).toBe(827);
  expect(revealBlogHeading(600, 73, 600, 0)).toBe(527);
});

test('a collapsed viewport or a document boundary cannot cause invalid scrolling', () => {
  expect(revealBlogHeading(100, 73, 50, 0)).toBeUndefined();
  expect(revealBlogHeading(50, 73, 600, 0)).toBe(0);
});
