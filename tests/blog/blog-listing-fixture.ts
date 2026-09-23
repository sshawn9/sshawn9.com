import type { BlogCatalog } from '../../apps/site/src/features/blog/runtime/blog-state';

export function createBlogCatalog(
  options: Omit<BlogCatalog, 'filterable'> & { filterable?: boolean },
): BlogCatalog {
  return { filterable: true, ...options };
}
