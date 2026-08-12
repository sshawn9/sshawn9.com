# sshawn9.com

Shawn's personal site for projects, a blog, and a personal introduction. The current copy is intentionally short placeholder content for deciding which sections to keep.

## Stack

- Astro 7 for static generation and official client-side view transitions
- Tailwind CSS 4 for the design system and responsive UI
- Astro Content Collections for typed articles and projects
- Paraglide JS for type-safe English and Chinese interface messages
- Expressive Code for code blocks
- Pagefind Component UI for build-time multilingual full-site search
- a small SolidJS island with Kobalte primitives for article filtering and pagination
- Tocbot for the active article table of contents
- Diff2Html and jsdiff for on-demand comparisons between complete article versions
- `astro-seo`, `astro-seo-schema`, and the official Astro sitemap integration for metadata
- the browser Popover API for menus and disclosure panels
- Motion for progressive, reduced-motion-aware animation
- Cloudflare Workers Static Assets for production hosting

## Development

```bash
npm ci
npm run dev
```

The repository convention also supports Astro's managed background server:

```bash
npm run astro -- dev --background
```

Full local verification:

```bash
npm run check
npm test
npm run format:check
npm run build
npm run test:e2e
npm run preview
```

Node 24 is the repository's tested development runtime; `.nvmrc` records that recommendation. `npm run build` generates the static site and its multilingual full-site Pagefind index. Browser tests use port 4322 so they never interfere with the normal development server on 4321.

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
├── meta.yaml         # shared dates, tags, project references, and publication state
├── index.md          # base English form
├── index.en.md       # optional explicit English form
├── index.zh.md       # optional Chinese form
└── images/
```

Once an article has a substantial revision, every immutable version becomes a complete snapshot:

```text
src/content/blog/my-article/
├── v1/
│   ├── meta.yaml
│   ├── index.md
│   ├── index.zh.md
│   └── images/
└── v2/
    ├── meta.yaml
    ├── index.md
    ├── index.zh.md
    └── images/
```

Astro loads every `meta.yaml` through a dedicated Content Collection. Its ID is derived from the directory path, so the adjacent Markdown files do not repeat that relationship:

```yaml
# meta.yaml
publishedAt: 2026-07-31
tags:
  - Astro
  - Content revision
projects:
  - my-project
```

```yaml
# index.zh.md frontmatter
title: 文章标题
description: 本地化摘要
```

For a versioned article, the metadata ID is the version path, such as `my-article/v2`. Dates, tags, and draft state therefore have one source of truth per complete version; titles, descriptions, revision summaries, and bodies remain localized.

`index.md` is the base English alias. If both `index.md` and `index.en.md` exist, the explicit English file wins. The code deliberately does not impose a complex prohibition system around partial translations.

Article discovery and language resolution are separate operations:

1. Discover every conceptual article directory.
2. Select the latest published conceptual version.
3. Resolve that same version in the requested language.
4. Fall back to the other available language when needed.
5. Render every conceptual article exactly once in every locale's article list.

Missing Chinese content therefore never removes an article from `/zh/blog/`, and a missing translation never causes the resolver to fall back to an older version.

Tags are content-independent canonical strings and are never translated. They live only in the version's shared `meta.yaml`. The blog taxonomy reads only the latest version of each conceptual article; older versions never contribute tags or counts:

```yaml
# meta.yaml
tags:
  - Astro
  - Content revision
```

The optional `projects` array uses Astro Content Collection references. One article can belong to several projects, and only the latest published version participates in project membership:

```yaml
projects:
  - autonomous-driving-motion-control
  - another-project
```

## Creating a revision

There is deliberately no repository-mutation script. When the first substantial revision is needed, preserve the original article and its metadata as the complete `v1/` snapshot and create `v2/` as a complete new snapshot. Later revisions add `v3/`, `v4/`, and so on. Copy any version-specific assets into that version directory and leave every published older directory unchanged.

The path parser in `src/lib/article-convention.ts` and the small adapter in `src/lib/articles.ts` are the only code that understand this convention. Routes and components consume normalized `Article` and `ArticleVersion` values rather than parsing paths themselves.

Version comparison has one canonical page per article. It downloads only the two selected immutable Markdown snapshots when a visitor opens that page.

## Page and project content

Localized page and interface copy lives in `messages/<locale>.json`. Each project keeps stable metadata, localized content, and future assets together:

```text
src/content/projects/my-project/
├── meta.yaml       # display order and stable project ID
├── index.en.md     # English summary and project body
├── index.zh.md     # optional Chinese summary and project body
└── images/
```

`src/lib/projects.ts` applies the same requested-language-then-fallback rule as articles. A detail page renders the authored project body first, then derives its related-article list from the latest published article metadata. Article titles and optional descriptions therefore follow the current locale and its normal fallback without being copied into project Markdown.

Paraglide owns page-level and interface copy. Long-form articles and project records remain in content collections.

## Quality checks

Vitest covers the article path, version, locale fallback, and tag-count conventions. Playwright covers behavior that static checks cannot prove: locale preference, ClientRouter language and theme transitions, fixed tag facets, and on-demand version comparison. The GitHub Actions verification job runs formatting, types, unit tests, a preview build, and those browser checks. A `main` deployment also rebuilds and tests the production variant before release.

## Deployment

Every pushed branch receives a stable Worker Preview URL. `main` owns the deployed `sshawn9-com-preview` Worker URL; other branches receive stable aliases without changing that deployment. Preview builds include draft articles, omit the sitemap, and emit both HTML and HTTP `noindex` directives. Pull requests run the same preview-mode verification without deploying secrets. Each deployment summary exposes both the stable branch URL and the immutable version URL. Deleted branches and older versions are not actively removed; Cloudflare's Preview URL retention policy owns their eventual cleanup.

On `main`, separately verified preview and production artifacts are deployed independently after verification. The production version excludes drafts and retains the sitemap; the preview version includes drafts and never changes production traffic. `workflow_dispatch` follows the same branch-specific behavior.

One GitHub Actions repository secret is required:

- `CLOUDFLARE_API_TOKEN`: a token created from Cloudflare's **Edit Cloudflare Workers** template and restricted to the target account

`wrangler.jsonc` is the source of truth for two isolated Worker environments. The default `sshawn9-com` Worker serves production through `sshawn9.com` and exposes no `workers.dev` or Preview URL. The `preview` environment deploys the draft-inclusive `main` build to `sshawn9-com-preview`; other branches upload non-deployed versions with stable aliases. Every build also receives an immutable version URL. The stable production custom-domain mapping is managed separately as long-lived Terraform infrastructure. No Cloudflare Pages project or per-branch DNS records are used.

For the one-time ownership migration, apply the `actions-private/cf-dns` configuration and verify that it has imported the existing `sshawn9.com` custom domain before deploying this repository's route-free Wrangler configuration.

## Current boundaries

- The old `sshawn9.github.io` articles are not migrated yet.
- Forms, comments, authentication, and other dynamic features should be added only when a real requirement appears.
