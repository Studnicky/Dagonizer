import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({
    base: new URL('../../docs/', import.meta.url),
    pattern: ['**/*.md', '!**/.vitepress/**', '!**/.orchestration/**'],
    generateId: ({ entry }) => entry.replace(/\\/g, '/').replace(/\.md$/, '')
  }),
  schema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    hero: z.any().optional(),
    seeAlso: z.array(z.object({
      text: z.string(),
      link: z.string(),
      description: z.string().optional()
    })).optional(),
    nextSteps: z.array(z.object({
      text: z.string(),
      link: z.string(),
      description: z.string().optional()
    })).optional()
  })
});

export const collections = { docs };
