import type { Locale } from '../i18n/config';
import { localePath } from '../i18n/config';
import {
  getArticlesForTag,
  getTagDefinitions,
  getTagSlug,
  type TagDefinition,
} from '@sshawn9/site-domain/tags';

export { getArticlesForTag, getTagDefinitions, getTagSlug, type TagDefinition };

export function getTagHref(name: string, locale: Locale): string {
  return localePath(locale, `/tags/${getTagSlug(name)}/`);
}
