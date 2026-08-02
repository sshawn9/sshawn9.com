---
title: 'Feature demo: a versioned article'
description: 'How one article keeps complete older editions while presenting a coherent latest edition by default.'
publishedAt: 2024-06-18
revisedAt: 2026-07-31
revisionSummary: 'Simplified version navigation and comparison for readers.'
tags:
  - { id: feature-demo, label: 'Feature demo' }
  - { id: blog, label: 'Blog' }
  - { id: astro, label: 'Astro' }
  - { id: markdown, label: 'Markdown' }
  - { id: content-management, label: 'Content management' }
  - { id: article-versions, label: 'Article versions' }
  - { id: long-term-maintenance, label: 'Long-term maintenance' }
  - { id: versioned-article, label: 'Versioned article' }
  - { id: content-revision, label: 'Content revision' }
  - { id: diff, label: 'Diff' }
  - { id: knowledge-management, label: 'Knowledge management' }
  - { id: information-architecture, label: 'Information architecture' }
featured: true
---

> This is the latest complete edition. Older editions remain available to read independently.

## Background

This sample article explains a subject that needs maintenance over a long lifetime.

## Scope

The approach suits long-lived articles that need ongoing additions and corrections. One-off essays normally do not need version directories.

## Current approach

The process has three steps:

1. Start with one article directory and a regular Markdown document.
2. At the first substantial revision, preserve the original in `v1/` and create a complete new edition.
3. Continue publishing complete editions; the article route selects the highest published version.

Each version directory is a self-contained snapshot, including its language variants and colocated images. Visitors can read any public edition or choose any other version to compare against the one they are reading.

## Conclusion

Readers receive the coherent latest edition by default and can switch editions or compare two of them when necessary.
