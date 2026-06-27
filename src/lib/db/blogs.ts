import { db, schema } from './client';
import type { Blog, MemberRole } from './schema';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { sluggify } from '$lib/utils';
import { refreshAllSnapshots } from './snapshots';
import { capabilitiesForRole } from './members';
import { decodeCursor, encodeCursor, type Page } from '$lib/pagination';

export async function listBlogs() {
	return db
		.select()
		.from(schema.blogs)
		.where(isNull(schema.blogs.archivedAt))
		.orderBy(desc(schema.blogs.createdAt));
}

type BlogCursor = { key: string; id: string };

/**
 * Cursor-paginated blog list (newest first). Keyset on (createdAt, id) so
 * concurrent inserts can't cause skips/duplicates between pages.
 */
export async function listBlogsPage(
	opts: {
		cursor?: string | null;
		limit?: number;
	} = {}
): Promise<Page<Blog>> {
	const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
	const cursor = decodeCursor<BlogCursor>(opts.cursor);

	const where = cursor
		? and(
				isNull(schema.blogs.archivedAt),
				or(
					lt(schema.blogs.createdAt, new Date(cursor.key)),
					and(eq(schema.blogs.createdAt, new Date(cursor.key)), lt(schema.blogs.id, cursor.id))
				)
			)
		: isNull(schema.blogs.archivedAt);

	const rows = await db
		.select()
		.from(schema.blogs)
		.where(where)
		.orderBy(desc(schema.blogs.createdAt), desc(schema.blogs.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const last = items[items.length - 1];
	const nextCursor =
		hasMore && last
			? encodeCursor({ key: last.createdAt.toISOString(), id: last.id } satisfies BlogCursor)
			: null;
	return { items, nextCursor };
}

export async function getBlogBySlug(slug: string) {
	const rows = await db.select().from(schema.blogs).where(eq(schema.blogs.slug, slug)).limit(1);
	return rows[0] ?? null;
}

export async function getBlogById(id: string) {
	const rows = await db.select().from(schema.blogs).where(eq(schema.blogs.id, id)).limit(1);
	return rows[0] ?? null;
}

async function blogsForUserWithRole(userId: string, roles: MemberRole[]) {
	const rows = await db
		.select({ blog: schema.blogs, role: schema.blogMembers.role })
		.from(schema.blogMembers)
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogMembers.blogId))
		.where(
			and(
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt),
				isNull(schema.blogs.archivedAt)
			)
		)
		.orderBy(desc(schema.blogs.createdAt));
	return rows.filter((r) => roles.includes(r.role)).map((r) => r.blog);
}

export const getOwnedBlogs = (uid: string) => blogsForUserWithRole(uid, ['owner']);
export const getEditedBlogs = (uid: string) => blogsForUserWithRole(uid, ['owner', 'editor']);
export const getReviewedBlogs = (uid: string) =>
	blogsForUserWithRole(uid, ['owner', 'editor', 'reviewer']);
export const getAuthoredBlogs = (uid: string) =>
	blogsForUserWithRole(uid, ['owner', 'editor', 'author']);

export async function createBlog(
	userId: string,
	title: string,
	description: string | null
): Promise<{ id: string; slug: string }> {
	const slug = sluggify(title);
	const inserted = await db
		.insert(schema.blogs)
		.values({ title, description, slug })
		.returning({ id: schema.blogs.id });
	const blog = inserted[0];
	await db.insert(schema.blogMembers).values({
		blogId: blog.id,
		userId,
		role: 'owner',
		...capabilitiesForRole('owner'),
		addedBy: userId
	});
	// Owner holds every capability → seed both the author and comment trees.
	await refreshAllSnapshots(blog.id);
	return { id: blog.id, slug };
}

export async function archiveBlog(blogId: string): Promise<void> {
	await db.update(schema.blogs).set({ archivedAt: new Date() }).where(eq(schema.blogs.id, blogId));
}

export async function unarchiveBlog(blogId: string): Promise<void> {
	await db.update(schema.blogs).set({ archivedAt: null }).where(eq(schema.blogs.id, blogId));
}
