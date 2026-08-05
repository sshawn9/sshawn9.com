import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const articleMetadata = defineCollection({
  loader: glob({
    base: './src/content/blog',
    pattern: '**/meta.yaml',
    generateId: ({ entry }) => entry.replace(/\/meta\.yaml$/, ''),
  }),
  schema: z.object({
    publishedAt: z.coerce.date(),
    revisedAt: z.coerce.date().optional(),
    tags: z.array(z.string().trim().min(1)).default([]),
    draft: z.boolean().default(false),
  }),
});

const blog = defineCollection({
  loader: glob({
    base: './src/content/blog',
    pattern: '**/*.{md,mdx}',
    generateId: ({ entry }) => entry.replace(/\.(?:md|mdx)$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    revisionSummary: z.string().min(1).optional(),
    canonical: z.url().optional(),
  }),
});

const projects = defineCollection({
  loader: glob({
    base: './src/content/projects',
    pattern: '**/*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    eyebrow: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.string(),
    tags: z.array(z.string()),
    accent: z.enum(['cyan', 'violet', 'amber']),
    order: z.number().int(),
    href: z.string().optional(),
    external: z.boolean().default(false),
  }),
});

export const collections = { articleMetadata, blog, projects };
