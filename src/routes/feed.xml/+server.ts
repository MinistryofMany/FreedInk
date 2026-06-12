// Global RSS feed of recently published posts across every non-archived blog.
// Cached for 5 minutes — RSS clients are aggressive pollers and the post-list
// changes rarely.
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { buildRss, rssExcerpt, type RssItem } from '$lib/server/rss';

export const prerender = false;

const ORIGIN = env.PUBLIC_ORIGIN || 'https://freed.ink';
const LIMIT = 50;

export const GET: RequestHandler = async () => {
	const rows = await db
		.select({
			blogSlug: schema.blogs.slug,
			blogTitle: schema.blogs.title,
			postSlug: schema.blogPostVersions.slug,
			title: schema.blogPostVersions.title,
			content: schema.blogPostVersions.content,
			publishedAt: schema.blogPostVersions.publishedAt
		})
		.from(schema.blogPosts)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
		.where(and(eq(schema.blogPosts.status, 'published'), isNull(schema.blogs.archivedAt)))
		.orderBy(desc(schema.blogPostVersions.publishedAt))
		.limit(LIMIT);

	const items: RssItem[] = rows.map((r) => {
		const link = `${ORIGIN}/b/${r.blogSlug}/${r.postSlug}`;
		return {
			title: `${r.title} — ${r.blogTitle}`,
			link,
			guid: link,
			description: rssExcerpt(r.content),
			pubDate: r.publishedAt ?? undefined
		};
	});

	const xml = buildRss(
		{
			title: 'FreedInk',
			link: ORIGIN,
			description: 'Recent posts across every blog on FreedInk.',
			selfLink: `${ORIGIN}/feed.xml`,
			lastBuildDate: rows[0]?.publishedAt ?? new Date()
		},
		items
	);

	return new Response(xml, {
		status: 200,
		headers: {
			'content-type': 'application/rss+xml; charset=utf-8',
			'cache-control': 'public, max-age=300'
		}
	});
};
