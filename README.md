# sshawn9.com

Shawn's personal site for projects, a blog, and a personal introduction. The current copy is intentionally short placeholder content for deciding which sections to keep.

## Stack

- Astro 7 for static generation and official client-side view transitions
- Tailwind CSS 4 for the design system and responsive UI
- Astro Content Collections for typed Markdown articles
- Paraglide JS for type-safe English and Chinese interface messages
- Expressive Code for code blocks
- Pagefind Component UI for build-time multilingual search and tag filtering
- Astro's built-in `paginate()` for the no-JavaScript article-list fallback
- Tocbot for the active article table of contents
- Diff2Html and jsdiff for build-time comparisons between complete article versions
- `astro-seo`, `astro-seo-schema`, and the official Astro sitemap integration for metadata
- the browser Popover API for menus and disclosure panels
- Motion for progressive, reduced-motion-aware animation

## Development

```bash
npm install
npm run dev
```

The repository convention also supports Astro's managed background server:

```bash
npm run astro -- dev --background
```

Full local verification:

```bash
npm run check
npm run format:check
npm run build
npm run preview
```

`npm run build` generates the static site, the full-site Pagefind index, and an article-only Pagefind index for the blog tag browser. Pagefind creates the English and Chinese language shards inside both indexes.

## Internationalization

English is the internal base language. Public pages always use a locale prefix:

```text
/en/...
/zh/...
```

The neutral `/` route chooses a locale from Paraglide's saved preference, then the browser's ordered language preferences, and finally English. An explicit locale in the URL determines the rendered page. The language icon switches directly between English and Chinese and saves that choice; no separate “auto” mode is exposed in the interface.

Interface messages live in `messages/en.json` and `messages/zh.json`. Astro owns the localized static route tree; Paraglide owns typed UI copy. Pagefind discovers the page's `<html lang>` and builds one index per language.

## Article content

Every conceptual article has its own directory so Markdown and assets can stay together.

A single-version article omits a version directory:

```text
src/content/blog/my-article/
├── index.md          # base English form
├── index.en.md       # optional explicit English form
├── index.zh.md       # optional Chinese form
└── images/
```

Once an article has a substantial revision, every immutable version becomes a complete snapshot:

```text
src/content/blog/my-article/
├── v1/
│   ├── index.md
│   ├── index.zh.md
│   └── images/
└── v2/
    ├── index.md
    ├── index.zh.md
    └── images/
```

`index.md` is the base English alias. If both `index.md` and `index.en.md` exist, the explicit English file wins. The code deliberately does not impose a complex prohibition system around partial translations.

Article discovery and language resolution are separate operations:

1. Discover every conceptual article directory.
2. Select the latest published conceptual version.
3. Resolve that same version in the requested language.
4. Fall back to the other available language when needed.
5. Render every conceptual article exactly once in every locale's article list.

Missing Chinese content therefore never removes an article from `/zh/blog/`, and a missing translation never causes the resolver to fall back to an older version.

For translated tags, use a stable ID and a localized label so filters survive a language switch:

```yaml
# index.md
tags:
  - { id: content-revision, label: 'Content revision' }
```

```yaml
# index.zh.md
tags:
  - { id: content-revision, label: '内容修订' }
```

Plain string tags remain supported for simple or single-language articles.

## Creating a revision

There is deliberately no repository-mutation script. When the first substantial revision is needed, preserve the original article as the complete `v1/` snapshot and create `v2/` as a complete new snapshot. Later revisions add `v3/`, `v4/`, and so on. Copy any version-specific assets into that version directory and leave every published older directory unchanged.

The small adapter in `src/lib/articles.ts` is the only code that understands this convention. Routes and components consume its normalized `Article` and `ArticleVersion` values rather than parsing paths themselves.

## Current boundaries

- The old `sshawn9.github.io` articles are not migrated yet.
- Deployment automation and hosting configuration are intentionally deferred.
- Forms, comments, authentication, and other dynamic features should be added only when a real requirement appears.
