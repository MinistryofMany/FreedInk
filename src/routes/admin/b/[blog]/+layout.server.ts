import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull } from 'drizzle-orm';
import { isFreedinkOperator } from '$lib/server/operators';

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
	// A FreedInk service operator is an owner-equivalent admin on every blog,
	// independent of any membership. Compute it on its own so an operator who is
	// ALSO a plain member (e.g. an 'author') of this blog keeps their real roles
	// AND retains operator capabilities — the subnav/capability checks OR in
	// `isOperator` (see +layout.svelte / index +page.server.ts). An operator with
	// no membership row gets a synthetic 'owner' role so the surface still renders.
	const isOperator = await isFreedinkOperator(locals.user.id);
	if (memberships.length === 0 && !isOperator) throw redirect(303, '/admin');

	return {
		blog: { id: blog.id, slug: blog.slug, title: blog.title, description: blog.description },
		roles:
			memberships.length > 0 ? memberships.map((m) => m.role) : (['owner'] as const).slice(),
		isOperator
	};
};
