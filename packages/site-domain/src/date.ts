import type { Locale } from './locales';

const formatters = new Map<Locale, Intl.DateTimeFormat>();

export function formatDate(date: Date, locale: Locale): string {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    formatters.set(locale, formatter);
  }
  return formatter.format(date);
}
