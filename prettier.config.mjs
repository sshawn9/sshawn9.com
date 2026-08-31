/** @type {import('prettier').Config} */
export default {
  plugins: ['prettier-plugin-astro', 'prettier-plugin-svelte'],
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
};
