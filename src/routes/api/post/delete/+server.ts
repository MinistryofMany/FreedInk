// Moderation unpublish/archive of a post. Auth + role check: only owner/editor
// of the blog that owns the post can hide it. This is NOT a hard delete - the
// post row, its content, and its full version history (incl. currentVersionId)
// stay intact; we only stamp blog_posts.archived_at, which the public slug
// loader and listings filter out. Reversible via api/post/restore.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireRole } from '$lib/server/auth';
import { archivePost } from '$lib/db/moderation';
import { audit } from '$lib/server/audit';

const MODERATING = ['owner', 'editor'] as const;

const Body = z.object({
	post_version_id: z.string().uuid()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const rows = await db
		.select({ version: schema.blogPostVersions, post: schema.blogPosts })
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.blogPostVersions.id, parsed.data.post_version_id))
		.limit(1);
	const row = rows[0];
	if (!row) throw error(404, 'post version not found');

	await requireRole(row.post.blogId, locals.user.id, MODERATING);

	await archivePost(row.post.id);

	await audit(event, {
		event: 'post.deleted',
		actorUserId: locals.user.id,
		subjectBlogId: row.post.blogId,
		metadata: { post_id: row.post.id, version_id: parsed.data.post_version_id }
	});

	return json({ ok: true });
};
