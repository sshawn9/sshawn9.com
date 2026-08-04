---
title: 'Feature demo: a versioned article'
description: 'How one article keeps complete older editions while presenting a coherent latest edition by default.'
revisionSummary: 'Clarified how complete editions and comparisons work.'
---

> This is the complete third edition. Older editions remain available to read independently.

## Background

This sample article explains a subject that needs maintenance over a long lifetime.

## Scope

The approach suits long-lived articles that need ongoing additions and corrections. One-off essays normally do not need version directories.

## Current approach

The process now has three steps:

1. Start with one article directory and a regular Markdown document.
2. At the first substantial revision, preserve that snapshot in `v1/` and create a complete `v2/`.
3. Continue publishing complete editions; the article route selects the highest published version.

Readers can open any public edition and compare the body of two editions.

## Conclusion

The default experience stays coherent, while previous information remains available when it matters.
