import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserWallets, getUserPasskeys } from '$lib/db/users';
import { db, schema } from '$lib/db/client';
import { eq, desc } from 'drizzle-orm';
import { SESSION_COOKIE_NAME, currentSessionId } from '$lib/server/session';

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const current = currentSessionId(cookies.get(SESSION_COOKIE_NAME));
	const [wallets, passkeys, identities, sessionRows] = await Promise.all([
		getUserWallets(locals.user.id),
		getUserPasskeys(locals.user.id),
		db
			.select({
				id: schema.userIdentities.id,
				idc: schema.userIdentities.idc,
				status: schema.userIdentities.status,
				createdAt: schema.userIdentities.createdAt,
				revokedAt: schema.userIdentities.revokedAt
			})
			.from(schema.userIdentities)
			.where(eq(schema.userIdentities.userId, locals.user.id))
			.orderBy(desc(schema.userIdentities.createdAt)),
		db
			.select({
				id: schema.sessions.id,
				createdAt: schema.sessions.createdAt,
				lastSeenAt: schema.sessions.lastSeenAt,
				userAgent: schema.sessions.userAgent,
				ip: schema.sessions.ip
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, locals.user.id))
			.orderBy(desc(schema.sessions.lastSeenAt))
	]);
	const sessions = sessionRows.map((s) => ({
		id: s.id,
		createdAt: s.createdAt,
		lastSeenAt: s.lastSeenAt,
		userAgent: s.userAgent,
		ip: s.ip,
		current: s.id === current
	}));
	return {
		user: {
			id: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName,
			email: locals.user.email,
			emailVerified: !!locals.user.emailVerifiedAt
		},
		wallets,
		passkeys,
		identities,
		sessions,
		verifiedFlash: url.searchParams.get('verified') === '1'
	};
};
