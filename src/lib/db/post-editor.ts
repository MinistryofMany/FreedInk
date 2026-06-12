// Post editing: create a new version of an existing post.
//
// Versioning model: blog_posts.current_version_id points at the live row in
// blog_post_versions. Editing means inserting a new version row with
// version = current+1, then atomically updating current_version_id (and the
// post's status if we're sending the new version to review immediately).
//
// Concurrency: two simultaneous edits could otherwise collide on the version
// number. We compute current+1 *inside* the transaction with a SELECT on the
// post row, and rely on the unique-on-nullifier constraint
// (blog_post_versions.post_id+nullifier) to catch the rare race where two
// authors submit different content with different nullifiers — both versions
// land, the second just wins the current pointer. That's acceptable: history
// is preserved.
import { db, schema } from './client';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { sluggify } from '$lib/utils';
import { hasRole, ROLES_WRITING } from '$lib/server/auth';
import { error } from '@sveltejs/kit';

export async function getEditablePostForUser(versionId: string, userId: string) {
	const rows = await db
		.select({
			post: schema.blogPosts,
			version: schema.blogPostVersions
		})
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.blogPostVersions.id, versionId))
		.limit(1);
	const row = rows[0];
	if (!row) throw error(404, 'post version not found');
	if (row.post.currentVersionId !== row.version.id) {
		throw error(409, 'not the current version of this post');
	}
	if (!(await hasRole(row.post.blogId, userId, ROLES_WRITING))) {
		throw error(403, 'forbidden');
	}
	return row;
}

// Look up the current version of a post by (blog_id, current_version.slug).
// Used by the edit page loader: the URL carries the post-version slug, we
// resolve to the underlying post + its current version. Returns null when
// the slug matches a non-current version (so the URL was stale) or no row.
export async function getCurrentPostBySlugForEdit(blogId: string, slug: string) {
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
		.where(and(eq(schema.blogPosts.blogId, blogId), eq(schema.blogPostVersions.slug, slug)))
		.limit(1);
	return rows[0] ?? null;
}

export type CreatePostVersionInput = {
	postId: string;
	title: string;
	content: string;
	proof: unknown;
	snapshotRoot: string;
	nullifier: string;
	submitForReview: boolean;
	// Optional. Falls back to the existing version's language so an editor who
	// doesn't change the picker keeps the original language.
	language?: string;
};

export async function createPostVersion(input: CreatePostVersionInput) {
	const slug = sluggify(input.title);
	const status: 'draft' | 'under_review' = input.submitForReview ? 'under_review' : 'draft';
	return db.transaction(async (tx) => {
		// Compute next version number inside the txn so concurrent edits don't
		// race on the same N. The composite unique index on
		// (post_id, nullifier) is the ultimate guard against duplicate submit.
		const latest = await tx
			.select({
				version: schema.blogPostVersions.version,
				language: schema.blogPostVersions.language
			})
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.postId, input.postId))
			.orderBy(desc(schema.blogPostVersions.version))
			.limit(1);
		const nextVersion = (latest[0]?.version ?? 0) + 1;
		const language = input.language ?? latest[0]?.language ?? 'en';

		const [version] = await tx
			.insert(schema.blogPostVersions)
			.values({
				postId: input.postId,
				version: nextVersion,
				title: input.title,
				content: input.content,
				slug,
				language,
				proof: input.proof as object,
				snapshotRoot: input.snapshotRoot,
				nullifier: input.nullifier,
				status,
				submittedAt: input.submitForReview ? new Date() : null
			})
			.returning();

		await tx
			.update(schema.blogPosts)
			.set({ currentVersionId: version.id, status })
			.where(eq(schema.blogPosts.id, input.postId));

		return { version, nextVersion };
	});
}
