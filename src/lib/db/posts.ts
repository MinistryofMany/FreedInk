import { db, schema } from './client';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { sluggify } from '$lib/utils';
import { decodeCursor, encodeCursor, type Page } from '$lib/pagination';

type DateIdCursor = { key: string; id: string };

function clampLimit(n: number | undefined, dflt = 20, max = 100): number {
	const v = n ?? dflt;
	if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) return dflt;
	return Math.min(v, max);
}

export async function listPublishedPosts(blogId: string) {
	const rows = await db
		.select({
			id: schema.blogPosts.id,
			status: schema.blogPosts.status,
			createdAt: schema.blogPosts.createdAt,
			version: {
				title: schema.blogPostVersions.title,
				content: schema.blogPostVersions.content,
				slug: schema.blogPostVersions.slug,
				publishedAt: schema.blogPostVersions.publishedAt
			}
		})
		.from(schema.blogPosts)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.where(
			and(
				eq(schema.blogPosts.blogId, blogId),
				eq(schema.blogPosts.status, 'published'),
				isNull(schema.blogPostVersions.deletedAt)
			)
		)
		.orderBy(desc(schema.blogPostVersions.publishedAt));
	return rows;
}

export async function listAllPosts(blogId: string) {
	const rows = await db
		.select({
			id: schema.blogPosts.id,
			status: schema.blogPosts.status,
			createdAt: schema.blogPosts.createdAt,
			currentVersionId: schema.blogPosts.currentVersionId,
			version: {
				id: schema.blogPostVersions.id,
				title: schema.blogPostVersions.title,
				content: schema.blogPostVersions.content,
				slug: schema.blogPostVersions.slug,
				status: schema.blogPostVersions.status
			}
		})
		.from(schema.blogPosts)
		.leftJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.where(eq(schema.blogPosts.blogId, blogId))
		.orderBy(desc(schema.blogPosts.createdAt));
	return rows;
}

export async function getPostBySlug(blogId: string, postSlug: string) {
	const rows = await db
		.select({
			post: schema.blogPosts,
			version: schema.blogPostVersions
		})
		.from(schema.blogPosts)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.where(
			and(
				eq(schema.blogPosts.blogId, blogId),
				eq(schema.blogPostVersions.slug, postSlug),
				isNull(schema.blogPostVersions.deletedAt)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function getPostsUnderReview(blogIds: string[]) {
	if (blogIds.length === 0) return [];
	return db
		.select({
			id: schema.blogPosts.id,
			blogId: schema.blogPosts.blogId,
			createdAt: schema.blogPosts.createdAt,
			version: {
				id: schema.blogPostVersions.id,
				title: schema.blogPostVersions.title,
				content: schema.blogPostVersions.content,
				slug: schema.blogPostVersions.slug,
				snapshotRoot: schema.blogPostVersions.snapshotRoot,
				submittedAt: schema.blogPostVersions.submittedAt
			}
		})
		.from(schema.blogPosts)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.where(
			and(inArray(schema.blogPosts.blogId, blogIds), eq(schema.blogPosts.status, 'under_review'))
		)
		.orderBy(desc(schema.blogPosts.createdAt));
}

// ─────────────────────────── paginated variants ───────────────────────────
//
// Cursor-paginated listings sit *next to* the unbounded variants — the older
// callers still work, new public-facing routes use these. Each one keysets on
// (sort_key, id) so concurrent writes between page fetches don't cause skips
// or duplicates. The id is a UUID, so the composite is total-order.

/** Published posts of one blog, newest published first. */
export async function listPublishedPostsPage(
	blogId: string,
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<
	Page<{
		id: string;
		status: 'draft' | 'under_review' | 'published' | 'rejected';
		createdAt: Date;
		version: {
			title: string;
			content: string;
			slug: string;
			publishedAt: Date | null;
		};
	}>
> {
	const limit = clampLimit(opts.limit);
	const cursor = decodeCursor<DateIdCursor>(opts.cursor);

	const base = and(
		eq(schema.blogPosts.blogId, blogId),
		eq(schema.blogPosts.status, 'published'),
		isNull(schema.blogPostVersions.deletedAt)
	);
	// Keyset on (publishedAt, blogPosts.id). publishedAt is required for
	// published posts but typed as nullable; we coalesce in the comparator.
	const where = cursor
		? and(
				base,
				or(
					lt(schema.blogPostVersions.publishedAt, new Date(cursor.key)),
					and(
						eq(schema.blogPostVersions.publishedAt, new Date(cursor.key)),
						lt(schema.blogPosts.id, cursor.id)
					)
				)
			)
		: base;

	const rows = await db
		.select({
			id: schema.blogPosts.id,
			status: schema.blogPosts.status,
			createdAt: schema.blogPosts.createdAt,
			version: {
				title: schema.blogPostVersions.title,
				content: schema.blogPostVersions.content,
				slug: schema.blogPostVersions.slug,
				publishedAt: schema.blogPostVersions.publishedAt
			}
		})
		.from(schema.blogPosts)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.where(where)
		.orderBy(desc(schema.blogPostVersions.publishedAt), desc(schema.blogPosts.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last && last.version.publishedAt
			? encodeCursor({
					key: last.version.publishedAt.toISOString(),
					id: last.id
				} satisfies DateIdCursor)
			: null;
	return { items, nextCursor };
}

/** All posts of one blog, newest first (admin view). */
export async function listAllPostsPage(
	blogId: string,
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<
	Page<{
		id: string;
		status: 'draft' | 'under_review' | 'published' | 'rejected';
		createdAt: Date;
		currentVersionId: string | null;
		version: {
			id: string;
			title: string;
			content: string;
			slug: string;
			status: 'draft' | 'under_review' | 'published' | 'rejected';
		} | null;
	}>
> {
	const limit = clampLimit(opts.limit);
	const cursor = decodeCursor<DateIdCursor>(opts.cursor);

	const base = eq(schema.blogPosts.blogId, blogId);
	const where = cursor
		? and(
				base,
				or(
					lt(schema.blogPosts.createdAt, new Date(cursor.key)),
					and(
						eq(schema.blogPosts.createdAt, new Date(cursor.key)),
						lt(schema.blogPosts.id, cursor.id)
					)
				)
			)
		: base;

	const rows = await db
		.select({
			id: schema.blogPosts.id,
			status: schema.blogPosts.status,
			createdAt: schema.blogPosts.createdAt,
			currentVersionId: schema.blogPosts.currentVersionId,
			version: {
				id: schema.blogPostVersions.id,
				title: schema.blogPostVersions.title,
				content: schema.blogPostVersions.content,
				slug: schema.blogPostVersions.slug,
				status: schema.blogPostVersions.status
			}
		})
		.from(schema.blogPosts)
		.leftJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.where(where)
		.orderBy(desc(schema.blogPosts.createdAt), desc(schema.blogPosts.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last
			? encodeCursor({
					key: last.createdAt.toISOString(),
					id: last.id
				} satisfies DateIdCursor)
			: null;
	return { items, nextCursor };
}

/** Posts under review across one or more blogs, newest first. */
export async function getPostsUnderReviewPage(
	blogIds: string[],
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<
	Page<{
		id: string;
		blogId: string;
		createdAt: Date;
		version: {
			id: string;
			title: string;
			content: string;
			slug: string;
			snapshotRoot: string | null;
			submittedAt: Date | null;
		};
	}>
> {
	if (blogIds.length === 0) return { items: [], nextCursor: null };
	const limit = clampLimit(opts.limit);
	const cursor = decodeCursor<DateIdCursor>(opts.cursor);

	const base = and(
		inArray(schema.blogPosts.blogId, blogIds),
		eq(schema.blogPosts.status, 'under_review')
	);
	const where = cursor
		? and(
				base,
				or(
					lt(schema.blogPosts.createdAt, new Date(cursor.key)),
					and(
						eq(schema.blogPosts.createdAt, new Date(cursor.key)),
						lt(schema.blogPosts.id, cursor.id)
					)
				)
			)
		: base;

	const rows = await db
		.select({
			id: schema.blogPosts.id,
			blogId: schema.blogPosts.blogId,
			createdAt: schema.blogPosts.createdAt,
			version: {
				id: schema.blogPostVersions.id,
				title: schema.blogPostVersions.title,
				content: schema.blogPostVersions.content,
				slug: schema.blogPostVersions.slug,
				snapshotRoot: schema.blogPostVersions.snapshotRoot,
				submittedAt: schema.blogPostVersions.submittedAt
			}
		})
		.from(schema.blogPosts)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.blogPosts.currentVersionId)
		)
		.where(where)
		.orderBy(desc(schema.blogPosts.createdAt), desc(schema.blogPosts.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last
			? encodeCursor({
					key: last.createdAt.toISOString(),
					id: last.id
				} satisfies DateIdCursor)
			: null;
	return { items, nextCursor };
}

/** Comments on one post version, newest first. */
export async function listCommentsPage(
	postVersionId: string,
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<
	Page<{
		id: string;
		body: string;
		createdAt: Date;
	}>
> {
	const limit = clampLimit(opts.limit);
	const cursor = decodeCursor<DateIdCursor>(opts.cursor);

	// Match the existing inline query: hide soft-deleted comments.
	const base = and(
		eq(schema.postComments.postVersionId, postVersionId),
		isNull(schema.postComments.deletedAt)
	);
	const where = cursor
		? and(
				base,
				or(
					lt(schema.postComments.createdAt, new Date(cursor.key)),
					and(
						eq(schema.postComments.createdAt, new Date(cursor.key)),
						lt(schema.postComments.id, cursor.id)
					)
				)
			)
		: base;

	const rows = await db
		.select({
			id: schema.postComments.id,
			body: schema.postComments.body,
			createdAt: schema.postComments.createdAt
		})
		.from(schema.postComments)
		.where(where)
		.orderBy(desc(schema.postComments.createdAt), desc(schema.postComments.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last
			? encodeCursor({
					key: last.createdAt.toISOString(),
					id: last.id
				} satisfies DateIdCursor)
			: null;
	return { items, nextCursor };
}

export type CreatePostInput = {
	blogId: string;
	title: string;
	content: string;
	proof: unknown;
	snapshotRoot: string;
	nullifier: string;
	status: 'draft' | 'under_review';
	// Optional. Falls back to the blog's defaultLanguage if unset.
	language?: string;
};

export async function createPost(input: CreatePostInput) {
	const slug = sluggify(input.title);
	return db.transaction(async (tx) => {
		// Resolve effective language inside the transaction so we always pick
		// up the blog's current default if the author didn't override.
		let language = input.language;
		if (!language) {
			const [b] = await tx
				.select({ defaultLanguage: schema.blogs.defaultLanguage })
				.from(schema.blogs)
				.where(eq(schema.blogs.id, input.blogId))
				.limit(1);
			language = b?.defaultLanguage ?? 'en';
		}

		const [post] = await tx
			.insert(schema.blogPosts)
			.values({ blogId: input.blogId, status: input.status })
			.returning();
		const [version] = await tx
			.insert(schema.blogPostVersions)
			.values({
				postId: post.id,
				version: 1,
				title: input.title,
				content: input.content,
				slug,
				language,
				proof: input.proof as object,
				snapshotRoot: input.snapshotRoot,
				nullifier: input.nullifier,
				status: input.status,
				submittedAt: input.status === 'under_review' ? new Date() : null
			})
			.returning();
		await tx
			.update(schema.blogPosts)
			.set({ currentVersionId: version.id })
			.where(eq(schema.blogPosts.id, post.id));
		return { post, version };
	});
}

export async function submitForReview(postVersionId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const [version] = await tx
			.update(schema.blogPostVersions)
			.set({ status: 'under_review', submittedAt: new Date() })
			.where(eq(schema.blogPostVersions.id, postVersionId))
			.returning();
		if (version) {
			await tx
				.update(schema.blogPosts)
				.set({ status: 'under_review' })
				.where(eq(schema.blogPosts.id, version.postId));
		}
	});
}

export async function setPostStatus(
	postId: string,
	versionId: string,
	status: 'published' | 'rejected'
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.update(schema.blogPostVersions)
			.set({
				status,
				publishedAt: status === 'published' ? new Date() : null
			})
			.where(eq(schema.blogPostVersions.id, versionId));
		await tx.update(schema.blogPosts).set({ status }).where(eq(schema.blogPosts.id, postId));
	});
}
