import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { markEmailVerified } from '$lib/db/users';
import { audit } from '$lib/server/audit';

export const GET: RequestHandler = async (event) => {
	const { url } = event;
	const token = url.searchParams.get('token');
	if (!token) return new Response('missing token', { status: 422 });

	const rows = await db
		.select()
		.from(schema.emailVerifications)
		.where(
			and(
				eq(schema.emailVerifications.token, token),
				isNull(schema.emailVerifications.consumedAt),
				gt(schema.emailVerifications.expiresAt, new Date())
			)
		)
		.limit(1);
	const row = rows[0];
	if (!row) return new Response('invalid or expired token', { status: 410 });

	await db.transaction(async (tx) => {
		await tx
			.update(schema.emailVerifications)
			.set({ consumedAt: new Date() })
			.where(eq(schema.emailVerifications.token, token));
		await tx
			.update(schema.users)
			.set({ email: row.email })
			.where(eq(schema.users.id, row.userId));
	});
	await markEmailVerified(row.userId);

	await audit(event, {
		event: 'email.verified',
		actorUserId: row.userId,
		subjectUserId: row.userId,
		metadata: { email: row.email }
	});

	throw redirect(303, '/settings?verified=1');
};
