---
title: "Hello - and how this blog works"
description: "A starter post: how to add articles here, and why this blog is the canonical home for everything I syndicate elsewhere."
pubDate: 2026-07-20
tags: ["meta", "writing"]
draft: false
---

This is a starter post. It exists to (1) prove the blog renders, and (2) document
how to add and syndicate articles. Delete it whenever you like.

## Adding a post

Drop a Markdown file in `src/content/blog/`. The filename becomes the URL slug, so
`the-small-model-bet.md` publishes at `/blog/the-small-model-bet/`. Every post needs
this frontmatter:

```yaml
---
title: "Your title"
description: "One sentence for search results and social cards."
pubDate: 2026-07-20
tags: ["local-llms", "agents"]
draft: false          # true keeps it out of production builds
# canonicalUrl: "https://..."   # only if first published elsewhere
---
```

That is it - commit, push, and GitHub Actions builds and deploys it.

## Why this blog is the canonical home

The strategy is **write once, publish here first, syndicate everywhere**. This blog
owns the canonical URL, so search engines credit *this* page even after the article
is cross-posted. The flow for each article:

1. Publish here (canonical).
2. Cross-post to Dev.to and others with a `canonical_url` pointing back to this URL.
3. Distribute the link to the right one or two communities (Hacker News, the right
   subreddits, Lobsters) - as a genuine contribution, not a drive-by ad.

> The one rule that keeps you out of trouble: lead with something worth reading. A
> real writeup, a benchmark, an honest postmortem - the project is the context, not
> the pitch.

If a piece was *first* published somewhere else, set `canonicalUrl` in its
frontmatter so this page defers to the original and you never compete with yourself
for ranking.

## What renders

Standard Markdown works: **bold**, *italic*, `inline code`, [links](/blog/), lists,
blockquotes, code blocks, and images. Headings become the on-page structure. Keep
posts focused and let each one stand on its own.

Happy writing.
