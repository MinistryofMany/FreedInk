import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireRole, ROLES_WRITING } from '$lib/server/auth';
import { submitForReview } from '$lib/db/posts';

const Body = z.object({ post_version_id: z.string().uuid() });

export const POST: RequestHandler = async ({ request, locals }) => {
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
	if (row.post.status !== 'draft') throw error(409, 'post is not a draft');

	await requireRole(row.post.blogId, locals.user.id, ROLES_WRITING);
	await submitForReview(parsed.data.post_version_id);
	return json({ ok: true });
};
