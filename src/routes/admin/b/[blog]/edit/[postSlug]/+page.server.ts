// Load a post for editing. The URL carries the *current* version's slug;
// if it doesn't match a live current version we 404. The user must have
// ROLES_WRITING on the blog or we redirect them out.
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { hasRole, ROLES_WRITING } from '$lib/server/auth';
import { getCurrentPostBySlugForEdit } from '$lib/db/post-editor';
import { getReviewFeedback } from '$lib/db/review-feedback';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, locals.user.id, ROLES_WRITING))) throw redirect(303, '/admin');

	const row = await getCurrentPostBySlugForEdit(blog.id, params.postSlug);
	if (!row) throw error(404, 'post not found');

	// Anonymized reviewer feedback on the current version (aggregate reason
	// counts + free-text comments). Useful for rejected posts the author is
	// re-editing; also non-noise for approved posts (just an empty section).
	const feedback = await getReviewFeedback(row.version.id);

	return {
		blog: {
			id: blog.id,
			slug: blog.slug,
			title: blog.title,
			defaultLanguage: blog.defaultLanguage
		},
		post: {
			id: row.post.id,
			status: row.post.status,
			versionId: row.version.id,
			version: row.version.version,
			title: row.version.title,
			content: row.version.content,
			slug: row.version.slug,
			language: row.version.language ?? blog.defaultLanguage ?? 'en'
		},
		feedback
	};
};
