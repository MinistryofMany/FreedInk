import { db, schema } from './client';
import { and, eq, sql, ilike, desc, lt, or, isNull } from 'drizzle-orm';
import { sluggify } from '$lib/utils';
import { decodeCursor, encodeCursor, type Page } from '$lib/pagination';

type DateIdCursor = { key: string; id: string };

function clampLimit(n: number | undefined, dflt = 20, max = 100): number {
	const v = n ?? dflt;
	if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) return dflt;
	return Math.min(v, max);
}

export async function listAllTags() {
	return db.select().from(schema.tags).orderBy(schema.tags.name);
}

export async function getOrCreateTag(name: string) {
	const slug = sluggify(name);
	const existing = await db.select().from(schema.tags).where(eq(schema.tags.slug, slug)).limit(1);
	if (existing[0]) return existing[0];
	const [created] = await db.insert(schema.tags).values({ name, slug }).returning();
	return created;
}

export async function setPostTags(postId: string, tagNames: string[]) {
	const tags = await Promise.all(tagNames.map((n) => getOrCreateTag(n)));
	await db.transaction(async (tx) => {
		await tx.delete(schema.blogPostTags).where(eq(schema.blogPostTags.postId, postId));
		if (tags.length === 0) return;
		await tx
			.insert(schema.blogPostTags)
			.values(tags.map((t) => ({ postId, tagId: t.id })))
			.onConflictDoNothing();
	});
	return tags;
}

export async function getTagsForPost(postId: string) {
	return db
		.select({ id: schema.tags.id, name: schema.tags.name, slug: schema.tags.slug })
		.from(schema.blogPostTags)
		.innerJoin(schema.tags, eq(schema.tags.id, schema.blogPostTags.tagId))
		.where(eq(schema.blogPostTags.postId, postId));
}

export async function searchPublishedPosts(opts: {
	query?: string;
	tagSlug?: string;
	blogId?: string;
	limit?: number;
}) {
	const conditions = [
		eq(schema.blogPosts.status, 'published'),
		isNull(schema.blogPosts.archivedAt)
	];
	if (opts.blogId) conditions.push(eq(schema.blogPosts.blogId, opts.blogId));
	if (opts.query) {
		conditions.push(
			sql`${schema.blogPostVersions.searchTsv} @@ websearch_to_tsquery('english', ${opts.query})`
		);
	}
	// When there's a text query, rank by relevance (ts_rank) first, then break
	// ties on (publishedAt, id) so the order is total and stable. Without a
	// query there's no meaningful rank, so we order purely by recency.
	const orderBy = opts.query
		? [
				desc(
					sql`ts_rank(${schema.blogPostVersions.searchTsv}, websearch_to_tsquery('english', ${opts.query}))`
				),
				desc(schema.blogPostVersions.publishedAt),
				desc(schema.blogPosts.id)
			]
		: [desc(schema.blogPostVersions.publishedAt), desc(schema.blogPosts.id)];
	const base = db
		.select({
			postId: schema.blogPosts.id,
			blog: { title: schema.blogs.title, slug: schema.blogs.slug },
			version: {
				title: schema.blogPostVersions.title,
				slug: schema.blogPostVersions.slug,
				content: schema.blogPostVersions.content,
				publishedAt: schema.blogPostVersions.publishedAt
			}
		})
		.from(schema.blogPosts)
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		);

	if (opts.tagSlug) {
		const rows = await base
			.innerJoin(schema.blogPostTags, eq(schema.blogPostTags.postId, schema.blogPosts.id))
			.innerJoin(schema.tags, eq(schema.tags.id, schema.blogPostTags.tagId))
			.where(and(...conditions, eq(schema.tags.slug, opts.tagSlug)))
			.orderBy(...orderBy)
			.limit(opts.limit ?? 50);
		return rows;
	}
	return base
		.where(and(...conditions))
		.orderBy(...orderBy)
		.limit(opts.limit ?? 50);
}

export async function suggestTags(q: string, limit = 10) {
	return db
		.select({ name: schema.tags.name, slug: schema.tags.slug })
		.from(schema.tags)
		.where(ilike(schema.tags.name, `%${q}%`))
		.limit(limit);
}

// ─────────────────────────── paginated variant ───────────────────────────

/**
 * Cursor-paginated search. Keyset on (publishedAt, blogPosts.id) — same as
 * listPublishedPostsPage so the ordering is consistent across surfaces.
 *
 * Pagination caveat - why this path stays recency-ordered, not rank-ordered:
 * keyset pagination requires the ORDER BY to match the cursor predicate
 * exactly, or rows get skipped/duplicated across pages. Our cursor encodes
 * (publishedAt, id), so the keyset sort must lead with those columns. ts_rank
 * cannot be the primary sort key here without baking a stable rank value into
 * the cursor, and Postgres ts_rank is not guaranteed reproducible across
 * separate queries (normalization, statistics), so it is unsafe as a keyset
 * key. Relevance ranking therefore lives on the non-paginated
 * `searchPublishedPosts`; this paginated variant orders strictly by recency.
 */
export async function searchPublishedPostsPage(opts: {
	query?: string;
	tagSlug?: string;
	blogId?: string;
	cursor?: string | null;
	limit?: number;
}): Promise<
	Page<{
		postId: string;
		blog: { title: string; slug: string };
		version: {
			title: string;
			slug: string;
			content: string;
			publishedAt: Date | null;
		};
	}>
> {
	const limit = clampLimit(opts.limit);
	const cursor = decodeCursor<DateIdCursor>(opts.cursor);

	const conditions = [
		eq(schema.blogPosts.status, 'published'),
		isNull(schema.blogPosts.archivedAt)
	];
	if (opts.blogId) conditions.push(eq(schema.blogPosts.blogId, opts.blogId));
	if (opts.query) {
		conditions.push(
			sql`${schema.blogPostVersions.searchTsv} @@ websearch_to_tsquery('english', ${opts.query})`
		);
	}
	if (cursor) {
		conditions.push(
			// or() may return undefined per drizzle's types when called with
			// undefineds — but here both branches are real conditions, so the
			// non-null assertion is safe.
			or(
				lt(schema.blogPostVersions.publishedAt, new Date(cursor.key)),
				and(
					eq(schema.blogPostVersions.publishedAt, new Date(cursor.key)),
					lt(schema.blogPosts.id, cursor.id)
				)
			)!
		);
	}

	const baseSelect = {
		postId: schema.blogPosts.id,
		blog: { title: schema.blogs.title, slug: schema.blogs.slug },
		version: {
			title: schema.blogPostVersions.title,
			slug: schema.blogPostVersions.slug,
			content: schema.blogPostVersions.content,
			publishedAt: schema.blogPostVersions.publishedAt
		}
	};

	const base = db
		.select(baseSelect)
		.from(schema.blogPosts)
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		);

	const rows = opts.tagSlug
		? await base
				.innerJoin(schema.blogPostTags, eq(schema.blogPostTags.postId, schema.blogPosts.id))
				.innerJoin(schema.tags, eq(schema.tags.id, schema.blogPostTags.tagId))
				.where(and(...conditions, eq(schema.tags.slug, opts.tagSlug)))
				.orderBy(desc(schema.blogPostVersions.publishedAt), desc(schema.blogPosts.id))
				.limit(limit + 1)
		: await base
				.where(and(...conditions))
				.orderBy(desc(schema.blogPostVersions.publishedAt), desc(schema.blogPosts.id))
				.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last && last.version.publishedAt
			? encodeCursor({
					key: last.version.publishedAt.toISOString(),
					id: last.postId
				} satisfies DateIdCursor)
			: null;
	return { items, nextCursor };
}
