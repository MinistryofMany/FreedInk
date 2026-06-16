import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const rows = await db
		.select({ id: schema.userIdentities.id })
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, locals.user.id),
				eq(schema.userIdentities.status, 'active')
			)
		)
		.limit(1);
	return {
		username: locals.user.username,
		displayName: locals.user.displayName,
		hasIdentity: rows.length > 0
	};
};
