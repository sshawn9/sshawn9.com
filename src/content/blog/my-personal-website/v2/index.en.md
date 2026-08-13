---
title: 'From Jekyll to Astro: Rebuilding My Personal Website'
description: 'A record of the technology upgrade from Jekyll to Astro, the principal technology choices, and the AI-assisted process of rebuilding my personal website.'
revisionSummary: 'A record of the redesign and technology migration of my personal website, rebuilt with AI assistance.'
---

## A technology upgrade

Several years ago, I built my first personal website with GitHub Pages, Jekyll, and Minimal Mistakes, and documented that process in the first version of this article series.

In the AI era, both technical research and development workflows have changed. I decided to use this opportunity for a complete technology upgrade of my personal website: rather than continue with the old Jekyll solution, I selected a new stack and rebuilt the site.

## Overall technology choices

The new site is based on [Astro](https://astro.build/). It generates static pages by default and loads client-side code only where interaction is actually required. This matches the primary form of a personal content site while leaving room for future dynamic features. [Tailwind CSS](https://tailwindcss.com/) establishes consistent visual and responsive rules, while Markdown and MDX remain the main formats for long-form content.

Articles, projects, and their assets follow explicit content conventions, with Astro Content Collections providing structural validation. The site supports Chinese and English interfaces and content fallback. Ordinary articles retain a simple directory structure; substantial revisions preserve complete historical versions and allow readers to switch between and compare them. General capabilities such as search, tables of contents, code presentation, and SEO use mature tools. Complex interactions are embedded as local components within articles, rather than making the whole site bear the runtime cost of a single-page application.

## Rebuilding with AI assistance

Frontend development is not my strongest field, but I can clearly define the problems the site needs to solve and judge whether its architecture, interactions, and final result meet those needs. I made the design decisions throughout this rebuild; AI mainly carried out research, organized documentation, implemented code, diagnosed problems, and supplemented tests.

The rebuild was not completed in a single pass. Many problems became visible only through actual use, including relationships among typographic hierarchy, interaction logic, responsive layout, and the content model. The rebuild therefore involved continuous review and correction: mature solutions took priority for common capabilities, while limited project-specific code was retained only where customization was genuinely necessary. No optimization was allowed to introduce a functional regression.

AI made research and implementation faster, but the site's goals, tradeoffs, and acceptance criteria still came from my own judgment of the content and user experience.
