import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );

  return rss({
    title: "Usman Shahid - Writing",
    description:
      "Technical writeups and opinions on local LLMs, agent orchestration, and small-model agents.",
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      categories: post.data.tags,
      // Canonical link: point at the original if the post was syndicated from
      // elsewhere, otherwise at this blog's own URL.
      link: post.data.canonicalUrl ?? `/blog/${post.id}/`,
    })),
  });
}
