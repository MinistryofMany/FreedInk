import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { hasRole, ROLES_WRITING } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, locals.user.id, ROLES_WRITING))) throw redirect(303, '/admin');
	return {
		blog: { id: blog.id, slug: blog.slug, title: blog.title, defaultLanguage: blog.defaultLanguage }
	};
};
