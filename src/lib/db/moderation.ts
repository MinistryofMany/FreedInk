// Soft-delete + restore helpers for posts and comments.
//
// Wave 1 added `deletedAt` columns to blog_post_versions and post_comments.
// Public readers filter `IS NULL` on deletedAt; admin views see everything.
// We never hard-delete here - restore is the inverse and stamps deletedAt back
// to NULL. The audit log records who did it.
//
// Post-level moderation uses archivePost/unarchivePost (blog_posts.archived_at)
// instead: it unpublishes a whole post while preserving its content and every
// version, and is the path the api/post/delete + restore endpoints take.
import { db, schema } from './client';
import { eq } from 'drizzle-orm';

export async function softDeletePostVersion(versionId: string): Promise<void> {
	await db
		.update(schema.blogPostVersions)
		.set({ deletedAt: new Date() })
		.where(eq(schema.blogPostVersions.id, versionId));
}

export async function restorePostVersion(versionId: string): Promise<void> {
	await db
		.update(schema.blogPostVersions)
		.set({ deletedAt: null })
		.where(eq(schema.blogPostVersions.id, versionId));
}

export async function softDeleteComment(commentId: string): Promise<void> {
	await db
		.update(schema.postComments)
		.set({ deletedAt: new Date() })
		.where(eq(schema.postComments.id, commentId));
}

export async function restoreComment(commentId: string): Promise<void> {
	await db
		.update(schema.postComments)
		.set({ deletedAt: null })
		.where(eq(schema.postComments.id, commentId));
}

// Moderation "delete" for a post = UNPUBLISH / ARCHIVE, never a hard delete.
// We stamp blog_posts.archived_at, which hides the post from every public
// surface (slug loader + listings filter `archivedAt IS NULL`) while leaving
// the row, its content, every version, and currentVersionId untouched. Fully
// restorable via unarchivePost. This is post-level, distinct from the
// version-level deletedAt used for comment-style soft deletes above.
export async function archivePost(postId: string): Promise<void> {
	await db
		.update(schema.blogPosts)
		.set({ archivedAt: new Date() })
		.where(eq(schema.blogPosts.id, postId));
}

export async function unarchivePost(postId: string): Promise<void> {
	await db
		.update(schema.blogPosts)
		.set({ archivedAt: null })
		.where(eq(schema.blogPosts.id, postId));
}

// Convenience: get the post + current version, used by the admin moderation
// page to render every version (including deleted ones) and to look up the
// owning blog for permission checks.
export async function getPostWithVersions(postId: string) {
	const postRows = await db
		.select()
		.from(schema.blogPosts)
		.where(eq(schema.blogPosts.id, postId))
		.limit(1);
	const post = postRows[0];
	if (!post) return null;
	const versions = await db
		.select()
		.from(schema.blogPostVersions)
		.where(eq(schema.blogPostVersions.postId, postId));
	const comments = await db
		.select()
		.from(schema.postComments)
		.where(eq(schema.postComments.postVersionId, post.currentVersionId ?? ''));
	return { post, versions, comments };
}
