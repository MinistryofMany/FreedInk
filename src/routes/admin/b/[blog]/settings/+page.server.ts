// Owner-only blog settings page. Loads the blog so the form can pre-fill,
// and gates on ROLES_MANAGING (owner).
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { hasRole, ROLES_MANAGING } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, locals.user.id, ROLES_MANAGING))) throw redirect(303, '/admin');
	return {
		blog: {
			id: blog.id,
			slug: blog.slug,
			title: blog.title,
			description: blog.description ?? '',
			approvalNumerator: blog.approvalNumerator,
			approvalDenominator: blog.approvalDenominator,
			defaultLanguage: blog.defaultLanguage ?? 'en'
		}
	};
};
