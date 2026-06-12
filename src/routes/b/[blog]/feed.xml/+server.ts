// Per-blog RSS feed. Same shape as the global feed, but scoped to one blog
// and using that blog's metadata as the channel title/description.
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { and, eq, desc } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getBlogBySlug } from '$lib/db/blogs';
import { buildRss, rssExcerpt, type RssItem } from '$lib/server/rss';

export const prerender = false;

const ORIGIN = env.PUBLIC_ORIGIN || 'https://freed.ink';
const LIMIT = 50;

export const GET: RequestHandler = async ({ params }) => {
	const blog = await getBlogBySlug(params.blog!);
	if (!blog || blog.archivedAt) throw error(404, 'blog not found');

	const rows = await db
		.select({
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
		.where(and(eq(schema.blogPosts.blogId, blog.id), eq(schema.blogPosts.status, 'published')))
		.orderBy(desc(schema.blogPostVersions.publishedAt))
		.limit(LIMIT);

	const blogUrl = `${ORIGIN}/b/${blog.slug}`;
	const selfLink = `${blogUrl}/feed.xml`;

	const items: RssItem[] = rows.map((r) => {
		const link = `${blogUrl}/${r.postSlug}`;
		return {
			title: r.title,
			link,
			guid: link,
			description: rssExcerpt(r.content),
			pubDate: r.publishedAt ?? undefined
		};
	});

	const xml = buildRss(
		{
			title: blog.title,
			link: blogUrl,
			description: blog.description || `Posts from ${blog.title} on FreedInk.`,
			selfLink,
			lastBuildDate: rows[0]?.publishedAt ?? blog.createdAt
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
