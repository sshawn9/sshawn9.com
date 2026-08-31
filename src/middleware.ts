import { defineMiddleware } from 'astro:middleware';
import { assertIsLocale, baseLocale, setLocale } from '@sshawn9/site-i18n/runtime';

export const onRequest = defineMiddleware((context, next) => {
  setLocale(assertIsLocale(context.currentLocale ?? baseLocale));
  return next();
});
