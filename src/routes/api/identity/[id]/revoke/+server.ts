import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { refreshSnapshotsForUser } from '$lib/db/snapshots';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';

// Revoke ONE of the caller's own device commitments (design D10: a user revokes
// their own devices; admins remove whole members, never a foreign device). The
// revoked commitment drops out of every tree on the next refresh, so that device
// can no longer produce a proof matching a current root (fail-closed: any
// in-flight proof from it fails requireCurrentRoot).
//
// Guardrail (D10/R9): block revoking your LAST active device — that would
// silently strip the ability to act with no recovery short of enrolling a new
// device. The user must enroll a replacement first (or use the rotate "reset all
// devices" panic flow).
export const POST: RequestHandler = async (event) => {
	await enforce(RULES.identityRotate, event, { keyBy: 'user' });
	const { locals, params } = event;
	if (!locals.user) throw error(401, 'sign in required');

	const id = params.id;
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw error(422, 'invalid identity id');

	// The row must belong to the caller and be currently active.
	const rows = await db
		.select({
			id: schema.userIdentities.id,
			idc: schema.userIdentities.idc,
			status: schema.userIdentities.status
		})
		.from(schema.userIdentities)
		.where(and(eq(schema.userIdentities.id, id), eq(schema.userIdentities.userId, locals.user.id)))
		.limit(1);
	const target = rows[0];
	if (!target) throw error(404, 'device not found');
	if (target.status !== 'active') throw error(409, 'device is already revoked');

	// Last-active-device guard.
	const active = await db
		.select({ id: schema.userIdentities.id })
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, locals.user.id),
				eq(schema.userIdentities.status, 'active')
			)
		);
	if (active.length <= 1) {
		throw error(
			409,
			'cannot revoke your last active device — enroll a new device first, or use "reset all devices"'
		);
	}

	await db
		.update(schema.userIdentities)
		.set({ status: 'revoked', revokedAt: new Date() })
		.where(eq(schema.userIdentities.id, target.id));

	// Recompute every tree of every blog the user is in so the revoked commitment
	// drops out and the current roots advance.
	await refreshSnapshotsForUser(locals.user.id);

	await audit(event, {
		event: 'identity.device_revoked',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { idc: target.idc, identity_id: target.id }
	});

	return json({ ok: true });
};
