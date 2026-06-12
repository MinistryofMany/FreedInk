import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { createBlog } from '$lib/db/blogs';
import { audit } from '$lib/server/audit';

const Body = z.object({
	title: z.string().min(1).max(200),
	description: z.string().max(2000).optional().nullable()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	const result = await createBlog(
		locals.user.id,
		parsed.data.title,
		parsed.data.description ?? null
	);
	await audit(event, {
		event: 'blog.created',
		actorUserId: locals.user.id,
		subjectBlogId: result.id,
		metadata: { slug: result.slug, title: parsed.data.title }
	});
	return json({ ok: true, ...result });
};
