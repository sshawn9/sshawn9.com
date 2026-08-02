import { defineMiddleware } from 'astro:middleware';
import { requireLocale } from './i18n/config';
import { baseLocale, setLocale } from './paraglide/runtime.js';

export const onRequest = defineMiddleware((context, next) => {
  const locale = context.currentLocale ? requireLocale(context.currentLocale) : baseLocale;
  setLocale(locale, { reload: false });
  return next();
});
