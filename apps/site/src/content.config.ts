import { PROJECT_PREVIEW_KINDS } from '@sshawn9/site-domain/projects';
import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blogDirectory = '../../content/blog';
const projectDirectory = '../../content/projects';

const projectMetadata = defineCollection({
  loader: glob({
    base: projectDirectory,
    pattern: '**/meta.yaml',
    generateId: ({ entry }) => entry.replace(/\/meta\.yaml$/, ''),
  }),
  schema: z.object({
    order: z.number().int(),
    preview: z.enum(PROJECT_PREVIEW_KINDS).optional(),
  }),
});

const articleMetadata = defineCollection({
  loader: glob({
    base: blogDirectory,
    pattern: '**/meta.yaml',
    generateId: ({ entry }) => entry.replace(/\/meta\.yaml$/, ''),
  }),
  schema: z.object({
    publishedAt: z.coerce.date(),
    revisedAt: z.coerce.date().optional(),
    tags: z.array(z.string().trim().min(1)).default([]),
    projects: z.array(reference('projectMetadata')).default([]),
    draft: z.boolean().default(false),
  }),
});

const blog = defineCollection({
  loader: glob({
    base: blogDirectory,
    pattern: '**/*.{md,mdx}',
    generateId: ({ entry }) => entry.replace(/\.(?:md|mdx)$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    revisionSummary: z.string().min(1).optional(),
    canonical: z.url().optional(),
  }),
});

const projects = defineCollection({
  loader: glob({
    base: projectDirectory,
    pattern: '**/*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
  }),
});

export const collections = { projectMetadata, articleMetadata, blog, projects };
