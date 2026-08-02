import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishedAt: z.coerce.date(),
      revisedAt: z.coerce.date().optional(),
      revisionSummary: z.string().min(1).optional(),
      tags: z
        .array(
          z.union([
            z.string().trim().min(1),
            z.object({
              id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
              label: z.string().trim().min(1),
            }),
          ]),
        )
        .default([]),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      canonical: z.url().optional(),
    }),
});

export const collections = { blog };
