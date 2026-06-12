import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireRole, ROLES_WRITING } from '$lib/server/auth';
import { setPostTags } from '$lib/db/tags';

const Body = z.object({
	post_id: z.string().uuid(),
	tags: z.array(z.string().min(1).max(40)).max(20)
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const [post] = await db
		.select({ blogId: schema.blogPosts.blogId })
		.from(schema.blogPosts)
		.where(eq(schema.blogPosts.id, parsed.data.post_id))
		.limit(1);
	if (!post) throw error(404, 'post not found');
	await requireRole(post.blogId, locals.user.id, ROLES_WRITING);

	const tags = await setPostTags(parsed.data.post_id, parsed.data.tags);
	return json({ ok: true, tags });
};
