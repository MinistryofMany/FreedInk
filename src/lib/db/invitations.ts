// Email-based invitations to join a blog. Schema lives in schema.ts; this
// module covers create / lookup / accept / list / revoke flows. Acceptance is
// transactional and idempotent for the (already-member-with-same-role) case.
//
// Bearer semantics: the token in the email IS the auth. We do NOT bind the
// invitation to the invitee's email at accept time — see the wave summary
// for rationale (simpler flow, no surprise mismatches when the user signs in
// with a different email than the one we mailed to; the link is single-use
// and expires in 7d).
import { db, schema } from './client';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { MemberRole } from './schema';
import { randomToken } from '$lib/server/session';
import { refreshSnapshot } from './snapshots';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const PROVING: MemberRole[] = ['owner', 'editor', 'reviewer', 'author'];

export type CreateInvitationInput = {
	blogId: string;
	invitedByUserId: string;
	email: string;
	role: MemberRole;
};

export async function createInvitation(
	input: CreateInvitationInput
): Promise<{ id: string; token: string; expiresAt: Date }> {
	const token = randomToken();
	const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
	const [row] = await db
		.insert(schema.blogInvitations)
		.values({
			blogId: input.blogId,
			invitedByUserId: input.invitedByUserId,
			email: input.email.trim().toLowerCase(),
			role: input.role,
			token,
			expiresAt
		})
		.returning({ id: schema.blogInvitations.id });
	return { id: row.id, token, expiresAt };
}

// Hydrated invitation row, suitable for the public landing page. Returns null
// when the token is missing, expired, accepted, or revoked.
export type InvitationContext = {
	id: string;
	blogId: string;
	blogTitle: string;
	blogSlug: string;
	email: string;
	role: MemberRole;
	expiresAt: Date;
	inviterUsername: string;
	inviterUserId: string;
};

export async function getInvitationByToken(token: string): Promise<InvitationContext | null> {
	const rows = await db
		.select({
			id: schema.blogInvitations.id,
			blogId: schema.blogInvitations.blogId,
			email: schema.blogInvitations.email,
			role: schema.blogInvitations.role,
			expiresAt: schema.blogInvitations.expiresAt,
			blogTitle: schema.blogs.title,
			blogSlug: schema.blogs.slug,
			inviterUsername: schema.users.username,
			inviterUserId: schema.users.id
		})
		.from(schema.blogInvitations)
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogInvitations.blogId))
		.innerJoin(schema.users, eq(schema.users.id, schema.blogInvitations.invitedByUserId))
		.where(
			and(
				eq(schema.blogInvitations.token, token),
				isNull(schema.blogInvitations.acceptedAt),
				isNull(schema.blogInvitations.revokedAt),
				gt(schema.blogInvitations.expiresAt, new Date())
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

export type AcceptInvitationInput = { token: string; userId: string };
export type AcceptInvitationResult = {
	invitationId: string;
	blogId: string;
	blogSlug: string;
	role: MemberRole;
	alreadyMember: boolean;
};

// Atomically mark an invitation accepted and add the invitee to the blog with
// the invitation's role. Throws SvelteKit `error(...)` on the failure paths
// the API surfaces directly to clients.
export async function acceptInvitation(
	input: AcceptInvitationInput
): Promise<AcceptInvitationResult> {
	const ctx = await getInvitationByToken(input.token);
	if (!ctx) throw error(410, 'invitation token is invalid, expired, or already used');

	// Look up existing membership outside the transaction first so we can
	// validate before re-checking inside; the inner check is what actually
	// guards the write.
	const existingMembers = await db
		.select()
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, ctx.blogId),
				eq(schema.blogMembers.userId, input.userId),
				isNull(schema.blogMembers.removedAt)
			)
		)
		.limit(1);
	const existing = existingMembers[0];
	if (existing && existing.role !== ctx.role) {
		throw error(
			409,
			`you are already a member of this blog as ${existing.role}; ask the owner to change your role directly`
		);
	}

	let provingDelta = false;
	const result = await db.transaction(async (tx) => {
		// Re-check + mark accepted in the same tx to avoid double-accept races.
		const claim = await tx
			.update(schema.blogInvitations)
			.set({ acceptedAt: sql`now()`, acceptedByUserId: input.userId })
			.where(
				and(
					eq(schema.blogInvitations.id, ctx.id),
					isNull(schema.blogInvitations.acceptedAt),
					isNull(schema.blogInvitations.revokedAt),
					gt(schema.blogInvitations.expiresAt, new Date())
				)
			)
			.returning({ id: schema.blogInvitations.id });
		if (claim.length === 0) {
			throw error(410, 'invitation token is invalid, expired, or already used');
		}

		if (!existing) {
			await tx.insert(schema.blogMembers).values({
				blogId: ctx.blogId,
				userId: input.userId,
				role: ctx.role,
				addedBy: ctx.inviterUserId
			});
			if (PROVING.includes(ctx.role)) provingDelta = true;
		}

		return {
			invitationId: ctx.id,
			blogId: ctx.blogId,
			blogSlug: ctx.blogSlug,
			role: ctx.role,
			alreadyMember: !!existing
		};
	});

	if (provingDelta) {
		await refreshSnapshot(ctx.blogId);
	}
	return result;
}

export type ListInvitationsOptions = {
	includeRevoked?: boolean;
	includeAccepted?: boolean;
	limit?: number;
};

export type InvitationSummary = {
	id: string;
	email: string;
	role: MemberRole;
	expiresAt: Date;
	createdAt: Date;
	acceptedAt: Date | null;
	revokedAt: Date | null;
	acceptedByUserId: string | null;
	acceptedByUsername: string | null;
	invitedByUsername: string;
};

export async function listInvitations(
	blogId: string,
	opts: ListInvitationsOptions = {}
): Promise<InvitationSummary[]> {
	const inviter = schema.users;
	const accepter = schema.users;
	const rows = await db
		.select({
			id: schema.blogInvitations.id,
			email: schema.blogInvitations.email,
			role: schema.blogInvitations.role,
			expiresAt: schema.blogInvitations.expiresAt,
			createdAt: schema.blogInvitations.createdAt,
			acceptedAt: schema.blogInvitations.acceptedAt,
			revokedAt: schema.blogInvitations.revokedAt,
			acceptedByUserId: schema.blogInvitations.acceptedByUserId,
			inviterUsername: inviter.username
		})
		.from(schema.blogInvitations)
		.innerJoin(inviter, eq(inviter.id, schema.blogInvitations.invitedByUserId))
		.where(eq(schema.blogInvitations.blogId, blogId))
		.orderBy(desc(schema.blogInvitations.createdAt))
		.limit(opts.limit ?? 50);

	// Resolve accepted-by usernames in a second query (drizzle aliasing of the
	// same table is fiddly enough that a follow-up lookup is cleaner here).
	const acceptedIds = rows
		.map((r) => r.acceptedByUserId)
		.filter((v): v is string => v !== null);
	const userMap = new Map<string, string>();
	if (acceptedIds.length > 0) {
		const users = await db
			.select({ id: accepter.id, username: accepter.username })
			.from(accepter)
			.where(
				// drizzle's `inArray` would also work; using OR for portability with
				// a small list is fine and avoids one more import.
				acceptedIds.length === 1
					? eq(accepter.id, acceptedIds[0])
					: sql`${accepter.id} IN (${sql.join(acceptedIds.map((id) => sql`${id}`), sql`, `)})`
			);
		for (const u of users) userMap.set(u.id, u.username);
	}

	return rows
		.filter((r) => (opts.includeRevoked ? true : r.revokedAt === null))
		.filter((r) => (opts.includeAccepted ? true : r.acceptedAt === null))
		.map((r) => ({
			id: r.id,
			email: r.email,
			role: r.role,
			expiresAt: r.expiresAt,
			createdAt: r.createdAt,
			acceptedAt: r.acceptedAt,
			revokedAt: r.revokedAt,
			acceptedByUserId: r.acceptedByUserId,
			acceptedByUsername: r.acceptedByUserId ? userMap.get(r.acceptedByUserId) ?? null : null,
			invitedByUsername: r.inviterUsername
		}));
}

// Mark an invitation revoked. Only owners of the parent blog may revoke; we
// verify ownership inside this function so callers don't have to re-derive it.
export async function revokeInvitation(
	invitationId: string,
	actorUserId: string
): Promise<{ ok: true; alreadyRevoked: boolean }> {
	const rows = await db
		.select({ blogId: schema.blogInvitations.blogId, revokedAt: schema.blogInvitations.revokedAt })
		.from(schema.blogInvitations)
		.where(eq(schema.blogInvitations.id, invitationId))
		.limit(1);
	const inv = rows[0];
	if (!inv) throw error(404, 'invitation not found');

	const ownership = await db
		.select({ role: schema.blogMembers.role })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, inv.blogId),
				eq(schema.blogMembers.userId, actorUserId),
				isNull(schema.blogMembers.removedAt),
				eq(schema.blogMembers.role, 'owner')
			)
		)
		.limit(1);
	if (ownership.length === 0) throw error(403, 'only the blog owner can revoke invitations');

	if (inv.revokedAt !== null) return { ok: true, alreadyRevoked: true };

	await db
		.update(schema.blogInvitations)
		.set({ revokedAt: sql`now()` })
		.where(
			and(
				eq(schema.blogInvitations.id, invitationId),
				isNull(schema.blogInvitations.revokedAt)
			)
		);
	return { ok: true, alreadyRevoked: false };
}
