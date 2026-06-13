// Sitemap of public content: home, /b index, every non-archived blog, and
// every published post within those blogs. SSR-only — needs DB access — and
// cached for one hour at the edge so we're not re-scanning posts per crawl.
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

export const prerender = false;

const ORIGIN = env.PUBLIC_ORIGIN || 'https://freed.ink';

function xmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function urlEntry(loc: string, lastmod?: Date | null): string {
	const lm = lastmod ? `\n    <lastmod>${lastmod.toISOString()}</lastmod>` : '';
	return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lm}\n  </url>`;
}

export const GET: RequestHandler = async () => {
	const blogs = await db
		.select({
			slug: schema.blogs.slug,
			createdAt: schema.blogs.createdAt
		})
		.from(schema.blogs)
		.where(isNull(schema.blogs.archivedAt));

	// Pull every published post version (joined to a non-archived blog) in one
	// query so we don't N+1 per blog.
	const posts = await db
		.select({
			blogSlug: schema.blogs.slug,
			postSlug: schema.blogPostVersions.slug,
			publishedAt: schema.blogPostVersions.publishedAt
		})
		.from(schema.blogPosts)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
		.where(
			and(
				eq(schema.blogPosts.status, 'published'),
				isNull(schema.blogPosts.archivedAt),
				isNull(schema.blogs.archivedAt)
			)
		);

	const entries: string[] = [];
	entries.push(urlEntry(`${ORIGIN}/`));
	entries.push(urlEntry(`${ORIGIN}/b`));
	for (const b of blogs) {
		entries.push(urlEntry(`${ORIGIN}/b/${b.slug}`, b.createdAt));
	}
	for (const p of posts) {
		entries.push(urlEntry(`${ORIGIN}/b/${p.blogSlug}/${p.postSlug}`, p.publishedAt));
	}

	const xml =
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
		entries.join('\n') +
		'\n</urlset>\n';

	return new Response(xml, {
		status: 200,
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
};
