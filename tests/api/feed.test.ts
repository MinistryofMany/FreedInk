// Coverage for global and per-blog RSS feeds. The feed tests insert a
// published post directly into the DB (bypassing the snark-proof workflow,
// which is exercised elsewhere) because we only care about the RSS rendering
// here, not the publication flow.
import { describe, it, expect } from 'vitest';
import { api } from './helpers';
import { makeUser, makeBlogWith } from '../setup/factories';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';

async function publishPostDirect(opts: {
	blogId: string;
	title: string;
	content: string;
	slug: string;
}) {
	const publishedAt = new Date();
	return db.transaction(async (tx) => {
		const [post] = await tx
			.insert(schema.blogPosts)
			.values({ blogId: opts.blogId, status: 'published' })
			.returning();
		const [version] = await tx
			.insert(schema.blogPostVersions)
			.values({
				postId: post.id,
				version: 1,
				title: opts.title,
				content: opts.content,
				slug: opts.slug,
				status: 'published',
				publishedAt
			})
			.returning();
		await tx
			.update(schema.blogPosts)
			.set({ currentVersionId: version.id })
			.where(eq(schema.blogPosts.id, post.id));
		return { post, version };
	});
}

describe('RSS feeds', () => {
	it('GET /feed.xml returns 200 RSS with our published post', async () => {
		const owner = await makeUser({ username: 'feeder' });
		const blog = await makeBlogWith({ owner, title: 'Feeder Blog' });
		await publishPostDirect({
			blogId: blog.id,
			title: 'Hello Feed World',
			content: 'A short post body.',
			slug: 'hello-feed-world'
		});

		const res = await api('/feed.xml');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type') ?? '').toMatch(/rss\+xml/);
		const body = await res.text();
		expect(body).toMatch(/<rss[^>]*version="2\.0"/);
		expect(body).toMatch(/<channel>/);
		expect(body).toContain('Hello Feed World');
		expect(body).toContain(`/b/${blog.slug}/hello-feed-world`);
	});

	it('GET /b/<slug>/feed.xml returns 200 RSS with the post', async () => {
		const owner = await makeUser({ username: 'perblog' });
		const blog = await makeBlogWith({ owner, title: 'Per Blog Feed' });
		await publishPostDirect({
			blogId: blog.id,
			title: 'Single Blog Post',
			content: 'body for per-blog feed',
			slug: 'single-blog-post'
		});

		const res = await api(`/b/${blog.slug}/feed.xml`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type') ?? '').toMatch(/rss\+xml/);
		const body = await res.text();
		expect(body).toContain('Single Blog Post');
		expect(body).toContain(`/b/${blog.slug}/single-blog-post`);
		// Channel-level metadata reflects this blog.
		expect(body).toContain('<title>Per Blog Feed</title>');
	});

	it('GET /b/<unknown>/feed.xml returns 404', async () => {
		const res = await api('/b/this-slug-does-not-exist/feed.xml');
		expect(res.status).toBe(404);
	});
});
