import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBlogBySlug } from '$lib/db/blogs';
import { refreshSnapshot } from '$lib/db/snapshots';
import { requireRole, ROLES_PROVING } from '$lib/server/auth';

const Body = z.object({ blog_slug: z.string().min(1) });

// Returns the current proving-eligible identity set + the matching snapshot root.
// Auth-gated: only members of the blog who could possibly prove (owner/editor/
// reviewer/author) can fetch the membership.
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const blog = await getBlogBySlug(parsed.data.blog_slug);
	if (!blog) throw error(404, 'blog not found');

	await requireRole(blog.id, locals.user.id, ROLES_PROVING);

	const snap = await refreshSnapshot(blog.id);
	return json({
		root: snap.root,
		identities: snap.identities,
		eligible_count: snap.eligibleCount
	});
};
