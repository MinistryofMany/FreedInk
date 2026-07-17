import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { getBlogBySlug } from '$lib/db/blogs';
import { hasCapability } from '$lib/server/auth';
import { refreshAllSnapshots } from '$lib/db/snapshots';
import { decideLeafEnroll } from '$lib/server/leaf-enroll';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';

// Enroll (or replace) the caller's per-blog Semaphore commitment.
//
// The commitment is derived client-side from the user's Ministry branch, so the
// same person on any device derives the identical commitment for a given blog —
// this is idempotent by construction. The client NEVER supplies its old
// commitment; the server resolves the (user, blog) leaf from the authenticated
// session alone.
//
// C1 (leaf-replacement gate). Replacing a DIFFERENT commitment is honored only
// when the user's server-authoritative Ministry epoch (`users.anonEpoch`,
// snapshotted from the verified id_token at login) STRICTLY exceeds the epoch the
// current leaf was keyed at. That is what makes a re-key the only way to swap a
// leaf, so an attacker cannot loop replacements to mint fresh RLN nullifiers and a
// stale device cannot clobber a freshly re-keyed commitment. Equality (same
// commitment) is a no-op success; a lower-or-equal epoch replacement is refused
// with no write.
const Body = z.object({
	blog_slug: z.string().min(1),
	// A Semaphore v4 commitment as a decimal string.
	idc: z.string().regex(/^\d+$/)
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	const { blog_slug, idc } = parsed.data;

	const blog = await getBlogBySlug(blog_slug);
	if (!blog) throw error(404, 'blog not found');

	const userId = locals.user.id;

	// Only members who can prove SOMETHING (write or comment) have a tree to be in.
	const canProve =
		(await hasCapability(blog.id, userId, 'author')) ||
		(await hasCapability(blog.id, userId, 'comment'));
	if (!canProve) throw error(403, 'forbidden');

	// The server-authoritative epoch. Absent means the user has never completed a
	// Ministry login carrying the claim — there is no authority to key on, so fail
	// closed rather than enroll an unversioned leaf.
	const tokenEpoch = locals.user.anonEpoch;
	if (tokenEpoch === null || tokenEpoch === undefined) {
		throw error(409, 'sign in with Minister to connect your identity');
	}

	// Fast idempotent path: the leaf already holds this exact commitment. No write,
	// no rate-limit — this fires on every routine proof build.
	const [current] = await db
		.select({ id: schema.userIdentities.id, idc: schema.userIdentities.idc })
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, userId),
				eq(schema.userIdentities.blogId, blog.id),
				eq(schema.userIdentities.status, 'active')
			)
		)
		.limit(1);
	if (current && current.idc === idc) return json({ ok: true, enrolled: true });

	// A genuine replacement (different commitment for an existing leaf) is the
	// RLN-relevant path: rate-limit it as the backstop to the epoch gate.
	const isReplacement = !!current;
	if (isReplacement) await enforce(RULES.identityRotate, event, { keyBy: 'user' });

	let replacedIdc: string | null = null;
	let wrote = false;
	try {
		await db.transaction(async (tx) => {
			// Re-read authoritatively inside the transaction (guards the TOCTOU with
			// the fast path above).
			const [row] = await tx
				.select({
					id: schema.userIdentities.id,
					idc: schema.userIdentities.idc,
					anonEpoch: schema.userIdentities.anonEpoch
				})
				.from(schema.userIdentities)
				.where(
					and(
						eq(schema.userIdentities.userId, userId),
						eq(schema.userIdentities.blogId, blog.id),
						eq(schema.userIdentities.status, 'active')
					)
				)
				.limit(1);

			// The C1 decision — the same rule the unit test pins.
			const decision = decideLeafEnroll({
				currentIdc: row?.idc ?? null,
				currentEpoch: row?.anonEpoch ?? null,
				newIdc: idc,
				tokenEpoch
			});

			if (decision.action === 'noop') return;
			if (decision.action === 'reject') {
				throw error(409, 'identity is already current; sign in with Minister to re-key');
			}
			if (decision.action === 'replace') {
				replacedIdc = row!.idc;
				await tx
					.update(schema.userIdentities)
					.set({ idc, anonEpoch: tokenEpoch })
					.where(eq(schema.userIdentities.id, row!.id));
			} else {
				await tx.insert(schema.userIdentities).values({
					userId,
					blogId: blog.id,
					idc,
					anonEpoch: tokenEpoch,
					status: 'active'
				});
			}
			wrote = true;

			// Fold the snapshot refresh into the same transaction so the new leaf and
			// its snapshot are visible atomically (audit W5).
			await refreshAllSnapshots(blog.id, tx);
		});
	} catch (err) {
		// A concurrent first-enroll losing the (user, blog) active-unique race, or a
		// commitment already enrolled elsewhere (global idc unique — the W2
		// tripwire): surface as a conflict rather than a 500.
		const { isUniqueViolation } = await import('$lib/server/db-errors');
		if (isUniqueViolation(err)) throw error(409, 'this identity commitment is already enrolled');
		throw err;
	}

	// A no-op raced under the fast path (the leaf already held this commitment):
	// nothing was written, so emit no audit event.
	if (!wrote) return json({ ok: true, enrolled: true });

	await audit(event, {
		event: replacedIdc ? 'identity.rotated' : 'identity.created',
		actorUserId: userId,
		subjectUserId: userId,
		metadata: { blog_id: blog.id, idc, ...(replacedIdc ? { replaced_idc: replacedIdc } : {}) }
	});
	return json({ ok: true, enrolled: true });
};
