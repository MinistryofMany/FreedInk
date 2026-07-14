import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';

// The RP mix secret for the Ministry anonymous-identity handoff (anon spec
// §9.2): base64url of >= 32 CSPRNG bytes, provisioned ONCE and never rotated
// (see .env.example — the value is identity-determining, spec invariant I9).
// Delivered to this signed-in page as page data so the derivation stays
// entirely client-side; the server never sees the per-app secret it gets
// mixed with, so holding/serving this value reveals nothing (spec §9.2).
// Fail closed: unset, non-base64url, or short → null, and the client keeps
// today's random identity generation.
function anonMixSecret(): string | null {
	const raw = env.MINISTER_ANON_RP_MIX_SECRET;
	if (!raw) return null;
	const stripped = raw.replace(/=+$/, '');
	if (!/^[A-Za-z0-9_-]+$/.test(stripped)) return null;
	// 32 bytes ↔ 43 base64url chars; RP_MIX_SECRET_MIN_BYTES in the SDK.
	if (Buffer.from(stripped, 'base64url').byteLength < 32) return null;
	return raw;
}

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
	const hasIdentity = rows.length > 0;
	return {
		username: locals.user.username,
		displayName: locals.user.displayName,
		hasIdentity,
		// Only exposed while an identity can still be created here.
		anonMixSecret: hasIdentity ? null : anonMixSecret()
	};
};
