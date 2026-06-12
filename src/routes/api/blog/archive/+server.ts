import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireRole, ROLES_MANAGING } from '$lib/server/auth';
import { archiveBlog, unarchiveBlog } from '$lib/db/blogs';
import { audit } from '$lib/server/audit';

const Body = z.object({
	blog_id: z.string().uuid(),
	archive: z.boolean()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	await requireRole(parsed.data.blog_id, locals.user.id, ROLES_MANAGING);
	if (parsed.data.archive) await archiveBlog(parsed.data.blog_id);
	else await unarchiveBlog(parsed.data.blog_id);
	await audit(event, {
		event: parsed.data.archive ? 'blog.archived' : 'blog.unarchived',
		actorUserId: locals.user.id,
		subjectBlogId: parsed.data.blog_id
	});
	return json({ ok: true });
};
