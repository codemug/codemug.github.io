import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

// Blog posts live as Markdown in src/content/blog/. Each file's name (minus
// .md) becomes its URL slug: src/content/blog/my-post.md -> /blog/my-post/.
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    // Hidden in production builds; visible in `astro dev`.
    draft: z.boolean().default(false),
    // Set this ONLY when the post was FIRST published somewhere else and that
    // URL should stay the canonical source (search-engine credit). Leave it
    // unset for original posts, and this blog is the canonical home - which is
    // the whole point: publish here first, then syndicate elsewhere with a
    // canonical link pointing back to this URL.
    canonicalUrl: z.string().url().optional(),
    // Optional per-post social-card image (absolute path from /public, e.g.
    // "/og/my-post.png"). Falls back to the site default.
    ogImage: z.string().optional(),
  }),
});

export const collections = { blog };
