import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import {
	getOwnedBlogs,
	getEditedBlogs,
	getReviewedBlogs,
	getAuthoredBlogs
} from '$lib/db/blogs';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const [owned, edited, reviewed, authored] = await Promise.all([
		getOwnedBlogs(locals.user.id),
		getEditedBlogs(locals.user.id),
		getReviewedBlogs(locals.user.id),
		getAuthoredBlogs(locals.user.id)
	]);
	return {
		user: {
			id: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName,
			email: locals.user.email
		},
		ownedBlogs: owned,
		editedBlogs: edited.filter((b) => !owned.some((o) => o.id === b.id)),
		reviewedBlogs: reviewed.filter(
			(b) => !owned.some((o) => o.id === b.id) && !edited.some((e) => e.id === b.id)
		),
		authoredBlogs: authored
	};
};
