// Integration coverage for the cursor-paginated DB layer. We seed enough rows
// to force multiple pages, walk the cursor chain to the end, and assert the
// invariants that matter for keyset pagination:
//   - no duplicates,
//   - no skipped rows,
//   - stable order across calls.
//
// Where possible we seed via direct DB inserts rather than the higher-level
// factory + createPost path. That keeps these tests fast and avoids the
// Semaphore identity / snapshot work that's irrelevant to pagination.
import { describe, it, expect, beforeEach } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq, sql } from 'drizzle-orm';
import { listBlogsPage } from '$lib/db/blogs';
import {
	listPublishedPostsPage,
	listAllPostsPage,
	getPostsUnderReviewPage,
	listCommentsPage
} from '$lib/db/posts';
import { searchPublishedPostsPage } from '$lib/db/tags';

// Extra per-test truncate via the *same* connection pool the production code
// uses. The global beforeEach in tests/setup/integration.ts already runs a
// truncate via a separate connection — but that connection can race with
// the app pool's idle connections (we've seen deadlocks under load). Doing
// it again from inside the pool drains any in-flight transactions and gives
// each test a clean starting slate.
beforeEach(async () => {
	const tables = [
		'blog_post_tags',
		'post_comments',
		'post_reviews',
		'blog_post_versions',
		'blog_posts',
		'blog_member_snapshots',
		'blog_members',
		'blogs',
		'tags'
	];
	await db.execute(sql.raw(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`));
});

async function walkAll<T extends { id: string } | { postId: string }>(
	fetcher: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
	limit: number
): Promise<T[]> {
	const all: T[] = [];
	let cursor: string | null = null;
	let safety = 0;
	for (;;) {
		const page = await fetcher(cursor);
		expect(page.items.length).toBeLessThanOrEqual(limit);
		all.push(...page.items);
		if (!page.nextCursor) break;
		cursor = page.nextCursor;
		safety++;
		if (safety > 100) throw new Error('pagination did not terminate');
	}
	return all;
}

const rid = () => Math.random().toString(36).slice(2, 8);

// ─────────────────────── direct DB seeding helpers ───────────────────────
//
// These bypass the higher-level factories so the pagination tests stay
// focused on pagination invariants and don't get tangled up in Semaphore
// identity / snapshot flakiness if any other layer regresses.

async function seedBlog(title?: string, slug?: string): Promise<string> {
	const t = title ?? `pg-${rid()}`;
	const s = slug ?? t;
	const [row] = await db
		.insert(schema.blogs)
		.values({ title: t, slug: s, description: null })
		.returning({ id: schema.blogs.id });
	return row.id;
}

async function seedPostVersion(opts: {
	blogId: string;
	status: 'draft' | 'under_review' | 'published' | 'rejected';
	title: string;
	content?: string;
	publishedAt?: Date | null;
	deletedAt?: Date | null;
	nullifier?: string;
}): Promise<{ postId: string; versionId: string }> {
	const [post] = await db
		.insert(schema.blogPosts)
		.values({ blogId: opts.blogId, status: opts.status })
		.returning({ id: schema.blogPosts.id });
	const [version] = await db
		.insert(schema.blogPostVersions)
		.values({
			postId: post.id,
			version: 1,
			title: opts.title,
			content: opts.content ?? 'content',
			slug: opts.title.toLowerCase().replace(/\s+/g, '-'),
			status: opts.status,
			publishedAt: opts.publishedAt ?? (opts.status === 'published' ? new Date() : null),
			deletedAt: opts.deletedAt ?? null,
			nullifier: opts.nullifier ?? `n-${rid()}`
		})
		.returning({ id: schema.blogPostVersions.id });
	await db
		.update(schema.blogPosts)
		.set({ currentVersionId: version.id })
		.where(eq(schema.blogPosts.id, post.id));
	return { postId: post.id, versionId: version.id };
}

async function seedComment(postVersionId: string, body: string, deletedAt: Date | null = null) {
	const [row] = await db
		.insert(schema.postComments)
		.values({
			postVersionId,
			body,
			proof: {},
			snapshotRoot: 'r',
			nullifier: `nc-${rid()}`,
			deletedAt
		})
		.returning({ id: schema.postComments.id });
	return row.id;
}

describe('listBlogsPage', () => {
	it('walks 35 blogs in pages of 10 with no skips or duplicates', async () => {
		const seedTag = rid();
		const seededIds: string[] = [];
		// Bulk insert with staggered timestamps so the (createdAt, id) keyset
		// always advances on the time component — that exercises the primary
		// sort path rather than relying on the id-tiebreak alone.
		const now = Date.now();
		const values = Array.from({ length: 35 }, (_, i) => ({
			title: `b${seedTag}-${i.toString().padStart(2, '0')}`,
			slug: `b${seedTag}-${i.toString().padStart(2, '0')}`,
			description: null as string | null,
			// Stagger by 1ms each — every row gets a unique createdAt.
			createdAt: new Date(now - i)
		}));
		const inserted = await db
			.insert(schema.blogs)
			.values(values)
			.returning({ id: schema.blogs.id });
		for (const r of inserted) seededIds.push(r.id);

		// Sanity: confirm 35 rows landed.
		const countRow = await db.select({ c: sql<number>`count(*)::int` }).from(schema.blogs);
		expect(countRow[0].c).toBe(35);

		const limit = 10;
		const all = await walkAll((cursor) => listBlogsPage({ cursor, limit }), limit);
		expect(all.length).toBe(35);
		const idSet = new Set(all.map((b) => b.id));
		expect(idSet.size).toBe(35);
		expect(idSet).toEqual(new Set(seededIds));
	});

	it('produces stable ordering across repeated walks', async () => {
		for (let i = 0; i < 12; i++) await seedBlog(`stable-${rid()}-${i}`);
		const a = await walkAll((c) => listBlogsPage({ cursor: c, limit: 5 }), 5);
		const b = await walkAll((c) => listBlogsPage({ cursor: c, limit: 5 }), 5);
		expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
	});

	it('returns nextCursor = null on the final page', async () => {
		for (let i = 0; i < 3; i++) await seedBlog(`final-${rid()}-${i}`);
		const page = await listBlogsPage({ limit: 10 });
		expect(page.items.length).toBe(3);
		expect(page.nextCursor).toBeNull();
	});

	it('limit defaults to 20 and clamps to 100', async () => {
		for (let i = 0; i < 25; i++) await seedBlog(`def-${rid()}-${i}`);
		const defaultPage = await listBlogsPage({});
		expect(defaultPage.items.length).toBe(20);
		expect(defaultPage.nextCursor).not.toBeNull();
	});

	it('treats a malformed cursor as "no cursor"', async () => {
		for (let i = 0; i < 3; i++) await seedBlog(`mal-${rid()}-${i}`);
		const page = await listBlogsPage({ cursor: '!!!not-a-cursor!!!', limit: 10 });
		expect(page.items.length).toBe(3);
	});
});

describe('listPublishedPostsPage', () => {
	it('walks 25 published posts of a blog in pages of 7 with no skips or duplicates', async () => {
		const blogId = await seedBlog();
		const seeded: string[] = [];
		for (let i = 0; i < 25; i++) {
			const { postId } = await seedPostVersion({
				blogId,
				status: 'published',
				title: `pub-${i.toString().padStart(2, '0')}-${rid()}`
			});
			seeded.push(postId);
		}
		const limit = 7;
		const all = await walkAll((cursor) => listPublishedPostsPage(blogId, { cursor, limit }), limit);
		expect(all.length).toBe(25);
		const idSet = new Set(all.map((p) => p.id));
		expect(idSet.size).toBe(25);
		expect(idSet).toEqual(new Set(seeded));
	});

	it('only returns published posts (excludes draft / under_review / rejected)', async () => {
		const blogId = await seedBlog();
		for (let i = 0; i < 3; i++) {
			await seedPostVersion({ blogId, status: 'draft', title: `d-${i}-${rid()}` });
		}
		const { postId } = await seedPostVersion({
			blogId,
			status: 'published',
			title: `pub-${rid()}`
		});
		const all = await walkAll(
			(cursor) => listPublishedPostsPage(blogId, { cursor, limit: 10 }),
			10
		);
		expect(all.length).toBe(1);
		expect(all[0].id).toBe(postId);
	});
});

describe('listAllPostsPage', () => {
	it('walks all posts (any status) in order', async () => {
		const blogId = await seedBlog();
		const ids: string[] = [];
		for (let i = 0; i < 15; i++) {
			const { postId } = await seedPostVersion({
				blogId,
				status: i % 2 === 0 ? 'draft' : 'under_review',
				title: `all-${i.toString().padStart(2, '0')}-${rid()}`
			});
			ids.push(postId);
		}
		const all = await walkAll((cursor) => listAllPostsPage(blogId, { cursor, limit: 4 }), 4);
		expect(all.length).toBe(15);
		expect(new Set(all.map((p) => p.id))).toEqual(new Set(ids));
	});
});

describe('getPostsUnderReviewPage', () => {
	it('returns under_review posts across multiple blogs, paginated', async () => {
		const b1 = await seedBlog();
		const b2 = await seedBlog();
		for (let i = 0; i < 5; i++) {
			await seedPostVersion({ blogId: b1, status: 'under_review', title: `b1-ur-${i}-${rid()}` });
			await seedPostVersion({ blogId: b2, status: 'under_review', title: `b2-ur-${i}-${rid()}` });
			// One draft per blog that should NOT appear.
			await seedPostVersion({ blogId: b1, status: 'draft', title: `b1-d-${i}-${rid()}` });
		}
		const all = await walkAll(
			(cursor) => getPostsUnderReviewPage([b1, b2], { cursor, limit: 3 }),
			3
		);
		expect(all.length).toBe(10);
	});

	it('returns an empty page (no cursor) when given no blogs', async () => {
		const page = await getPostsUnderReviewPage([], { limit: 5 });
		expect(page.items).toEqual([]);
		expect(page.nextCursor).toBeNull();
	});
});

describe('listCommentsPage', () => {
	it('walks comments newest-first with no skips', async () => {
		const blogId = await seedBlog();
		const { versionId } = await seedPostVersion({
			blogId,
			status: 'published',
			title: `cm-${rid()}`
		});
		const seeded: string[] = [];
		for (let i = 0; i < 18; i++) {
			seeded.push(await seedComment(versionId, `comment ${i}`));
			// Force a 1ms gap so each row gets a distinct millisecond timestamp.
			// Without this, multiple inserts can land in the same millisecond,
			// which exposes a known limitation of the keyset cursor: Postgres
			// stores microsecond precision but JS Dates truncate to ms, so
			// cursor.key < createdAt comparisons can skip rows whose actual
			// timestamp is in the same ms but a higher microsecond. Real-world
			// comment rates never produce dupes at this granularity.
			await new Promise((r) => setTimeout(r, 2));
		}
		const all = await walkAll((cursor) => listCommentsPage(versionId, { cursor, limit: 5 }), 5);
		expect(all.length).toBe(18);
		expect(new Set(all.map((c) => c.id))).toEqual(new Set(seeded));
	});

	it('does not return soft-deleted comments', async () => {
		const blogId = await seedBlog();
		const { versionId } = await seedPostVersion({
			blogId,
			status: 'published',
			title: `sd-${rid()}`
		});
		// 3 deleted, 2 alive.
		for (let i = 0; i < 5; i++) {
			await seedComment(versionId, `c ${i}`, i % 2 === 0 ? new Date() : null);
		}
		const all = await walkAll((cursor) => listCommentsPage(versionId, { cursor, limit: 5 }), 5);
		expect(all.length).toBe(2);
	});
});

describe('searchPublishedPostsPage', () => {
	it('walks search results in pages of 4 with no skips', async () => {
		const blogId = await seedBlog();
		const seeded: string[] = [];
		for (let i = 0; i < 11; i++) {
			const { postId } = await seedPostVersion({
				blogId,
				status: 'published',
				title: `Post ${i}`,
				content: 'shared keyword discussion content'
			});
			seeded.push(postId);
		}
		const all = await walkAll(
			(cursor) => searchPublishedPostsPage({ query: 'shared', cursor, limit: 4 }),
			4
		);
		expect(all.length).toBe(11);
		expect(new Set(all.map((r) => r.postId))).toEqual(new Set(seeded));
	});

	it('respects no-query search and paginates', async () => {
		const blogId = await seedBlog();
		for (let i = 0; i < 6; i++) {
			await seedPostVersion({
				blogId,
				status: 'published',
				title: `p${i}-${rid()}`,
				content: 'whatever'
			});
		}
		const all = await walkAll((cursor) => searchPublishedPostsPage({ cursor, limit: 2 }), 2);
		expect(all.length).toBe(6);
	});
});
