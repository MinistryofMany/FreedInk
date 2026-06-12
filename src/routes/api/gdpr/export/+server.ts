// GDPR / data-portability export. Returns a JSON document of everything we
// hold linked to the requesting user. Deliberately omits material that would
// be (a) useless to the user in isolation (passkey public keys), or (b)
// already in the user's possession on their devices and risky to re-emit in
// a file they might email around (identity ciphertext).
//
// Audit-logged as `gdpr.export`.
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';

export const POST: RequestHandler = async (event) => {
	const { locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const userId = locals.user.id;

	const [profile] = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1);

	const wallets = await db
		.select({
			address: schema.walletAddresses.address,
			linkedAt: schema.walletAddresses.linkedAt
		})
		.from(schema.walletAddresses)
		.where(eq(schema.walletAddresses.userId, userId));

	// Note: deliberately NOT returning public_key bytes — a hex-rendered
	// public key is useless to the user but inflates the export.
	const passkeys = await db
		.select({
			id: schema.passkeyCredentials.id,
			credentialId: schema.passkeyCredentials.credentialId,
			nickname: schema.passkeyCredentials.nickname,
			transports: schema.passkeyCredentials.transports,
			aaguid: schema.passkeyCredentials.aaguid,
			createdAt: schema.passkeyCredentials.createdAt,
			lastUsedAt: schema.passkeyCredentials.lastUsedAt
		})
		.from(schema.passkeyCredentials)
		.where(eq(schema.passkeyCredentials.userId, userId));

	// Identities: include only public fields. NO ciphertext / kdfSalt / nonce
	// because the user already has the secret vault locally; emitting it here
	// turns a stolen export file into a secondary attack surface.
	const identities = await db
		.select({
			id: schema.userIdentities.id,
			idc: schema.userIdentities.idc,
			publicKey: schema.userIdentities.publicKey,
			status: schema.userIdentities.status,
			createdAt: schema.userIdentities.createdAt,
			revokedAt: schema.userIdentities.revokedAt
		})
		.from(schema.userIdentities)
		.where(eq(schema.userIdentities.userId, userId));

	const memberships = await db
		.select({
			blogId: schema.blogMembers.blogId,
			role: schema.blogMembers.role,
			addedAt: schema.blogMembers.addedAt,
			removedAt: schema.blogMembers.removedAt,
			blogSlug: schema.blogs.slug,
			blogTitle: schema.blogs.title
		})
		.from(schema.blogMembers)
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogMembers.blogId))
		.where(eq(schema.blogMembers.userId, userId));

	const sessions = await db
		.select({
			id: schema.sessions.id,
			createdAt: schema.sessions.createdAt,
			expiresAt: schema.sessions.expiresAt,
			lastSeenAt: schema.sessions.lastSeenAt,
			userAgent: schema.sessions.userAgent,
			ip: schema.sessions.ip
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.userId, userId));

	const payload = {
		exportedAt: new Date().toISOString(),
		schemaVersion: 1,
		notice:
			'This export contains everything FreedInk holds that is linked to your user account. ' +
			'Posts and comments are NOT included: they were submitted with Semaphore zero-knowledge ' +
			'proofs and are not linked to any user in our database. Public keys and identity ' +
			'ciphertext are intentionally omitted — public keys are useless to you in isolation, ' +
			'and the encrypted identity vault is already on your device.',
		user: {
			id: profile?.id ?? userId,
			username: profile?.username ?? null,
			displayName: profile?.displayName ?? null,
			email: profile?.email ?? null,
			emailVerifiedAt: profile?.emailVerifiedAt ?? null,
			createdAt: profile?.createdAt ?? null,
			updatedAt: profile?.updatedAt ?? null
		},
		wallets,
		// credentialId is bytea — render as base64url so it stays in JSON.
		passkeys: passkeys.map((p) => ({
			id: p.id,
			credentialId: Buffer.from(p.credentialId).toString('base64url'),
			nickname: p.nickname,
			transports: p.transports,
			aaguid: p.aaguid,
			createdAt: p.createdAt,
			lastUsedAt: p.lastUsedAt
		})),
		identities,
		memberships,
		sessions
	};

	await audit(event, { event: 'gdpr.export', subjectUserId: userId });

	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const body = JSON.stringify(payload, null, 2);
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="freedink-export-${userId}-${ts}.json"`,
			'cache-control': 'no-store'
		}
	});
};
