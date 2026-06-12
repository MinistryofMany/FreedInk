// Soft-delete a comment. Owner/editor of the blog that owns the comment's
// post version can hide it. Public reads filter on deletedAt IS NULL.
//
// Note: this endpoint only supports delete (no restore yet). Restore for
// comments is exposed through the admin moderation page via a server action.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireRole } from '$lib/server/auth';
import { softDeleteComment, restoreComment } from '$lib/db/moderation';
import { audit } from '$lib/server/audit';

const MODERATING = ['owner', 'editor'] as const;

const Body = z.object({
	comment_id: z.string().uuid(),
	restore: z.boolean().optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const rows = await db
		.select({
			comment: schema.postComments,
			version: schema.blogPostVersions,
			post: schema.blogPosts
		})
		.from(schema.postComments)
		.innerJoin(
			schema.blogPostVersions,
			eq(schema.blogPostVersions.id, schema.postComments.postVersionId)
		)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.postComments.id, parsed.data.comment_id))
		.limit(1);
	const row = rows[0];
	if (!row) throw error(404, 'comment not found');

	await requireRole(row.post.blogId, locals.user.id, MODERATING);

	if (parsed.data.restore) {
		await restoreComment(parsed.data.comment_id);
	} else {
		await softDeleteComment(parsed.data.comment_id);
	}

	await audit(event, {
		event: 'comment.deleted',
		actorUserId: locals.user.id,
		subjectBlogId: row.post.blogId,
		metadata: {
			comment_id: parsed.data.comment_id,
			post_id: row.post.id,
			version_id: row.version.id,
			restored: parsed.data.restore ?? false
		}
	});

	return json({ ok: true });
};
