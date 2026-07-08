import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getOwnedBlogs, getEditedBlogs, getReviewedBlogs, getAuthoredBlogs } from '$lib/db/blogs';
import { isFreedinkOperator } from '$lib/server/operators';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const [owned, edited, reviewed, authored, isOperator] = await Promise.all([
		getOwnedBlogs(locals.user.id),
		getEditedBlogs(locals.user.id),
		getReviewedBlogs(locals.user.id),
		getAuthoredBlogs(locals.user.id),
		isFreedinkOperator(locals.user.id)
	]);
	return {
		user: {
			id: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName,
			email: locals.user.email
		},
		isOperator,
		// Owners hold every downstream capability, so their blogs legitimately belong
		// in the Editing and Reviewing groups too — that is the only link by which an
		// owner reaches their own Review queue / Settings from the dashboard. Do NOT
		// filter owned blogs out of those groups.
		ownedBlogs: owned,
		editedBlogs: edited,
		reviewedBlogs: reviewed,
		authoredBlogs: authored
	};
};
