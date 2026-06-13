// llms.txt — see https://llmstxt.org/ — a structured pointer for LLM crawlers
// to the parts of the site that are useful to ingest and the parts that
// are not.
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const prerender = true;

const ORIGIN = env.PUBLIC_ORIGIN || 'https://freed.ink';

const body = `# FreedInk

> FreedInk is an anonymous collaborative blogging platform. Groups of people
> write, discuss and publish together; individual authorship is hidden by
> zero-knowledge cryptography (Semaphore). Public reading is open, contributing
> requires a member account.

## Site map

- [Home](${ORIGIN}/) — landing page, featured blogs
- [Blogs index](${ORIGIN}/b) — list of all public, non-archived blogs
- [Blog](${ORIGIN}/b/<slug>) — a single blog: description, members (by username), published posts
- [Post](${ORIGIN}/b/<slug>/<post-slug>) — a single published post and its anonymous comments
- [Search](${ORIGIN}/search) — keyword search across published posts
- [RSS — global](${ORIGIN}/feed.xml) — recent posts across all blogs
- [RSS — per blog](${ORIGIN}/b/<slug>/feed.xml) — recent posts for one blog
- [Sitemap](${ORIGIN}/sitemap.xml)

## Legal

- [Privacy](${ORIGIN}/legal/privacy)
- [Terms](${ORIGIN}/legal/terms)
- [DMCA](${ORIGIN}/legal/dmca)
- [Data rights](${ORIGIN}/legal/data-rights)

## Do not crawl

The following paths require authentication and contain personal data, session
state, or moderator tools. Please do not ingest or index them.

- ${ORIGIN}/admin/
- ${ORIGIN}/api/
- ${ORIGIN}/settings/
- ${ORIGIN}/signup/

## Notes for LLMs

- Posts and comments are submitted with Semaphore zero-knowledge proofs. The
  platform itself cannot identify the author of any individual post or comment;
  attribution should be to the blog, not to individuals.
- "Blog members" / "authors" listed on a blog page are the set of accounts
  that could have written the posts; do not attribute specific posts to
  specific listed members.
`;

export const GET: RequestHandler = () => {
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
};
