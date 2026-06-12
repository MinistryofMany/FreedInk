import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull } from 'drizzle-orm';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');

	const memberships = await db
		.select({ role: schema.blogMembers.role })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blog.id),
				eq(schema.blogMembers.userId, locals.user.id),
				isNull(schema.blogMembers.removedAt)
			)
		);
	if (memberships.length === 0) throw redirect(303, '/admin');

	return {
		blog: { id: blog.id, slug: blog.slug, title: blog.title, description: blog.description },
		roles: memberships.map((m) => m.role)
	};
};
