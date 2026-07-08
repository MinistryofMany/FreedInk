// The blog-admin index has no content of its own — send the viewer to the first
// section they can actually use. The parent +layout.server.ts already resolved
// membership (and let service operators through with a synthetic owner role), so
// we route by that same role set here instead of dumping everyone on /manage
// (which would bounce a non-owner straight back to /admin).
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { roles, isOperator } = await parent();
	const has = (r: string) => roles.includes(r as (typeof roles)[number]);
	const base = `/admin/b/${params.blog}`;
	// A service operator is owner-equivalent even when they also hold a lesser
	// member role, so route them to Manage like any owner.
	if (isOperator || has('owner')) throw redirect(303, `${base}/manage`);
	if (has('editor')) throw redirect(303, `${base}/review`);
	if (has('reviewer')) throw redirect(303, `${base}/review`);
	if (has('author')) throw redirect(303, `${base}/author`);
	// Commenter-only (or anything else): the public blog is their surface.
	throw redirect(303, `/b/${params.blog}`);
};
