import { db, schema } from './client';
import { and, eq, isNull, desc, inArray } from 'drizzle-orm';
import type { MemberRole, Capability } from './schema';
import { refreshSnapshot, refreshAllSnapshots } from './snapshots';
import { pregenOnReviewerAdded } from '$lib/server/vote-key-pregen';

const PROVING: MemberRole[] = ['owner', 'editor', 'reviewer', 'author'];

function affectsProvingSet(...roles: MemberRole[]) {
	return roles.some((r) => PROVING.includes(r));
}

// The capability column names on blog_members, indexed by capability. Single
// source of truth so callers never hard-code 'can_author' etc.
export const CAPABILITY_COLUMN = {
	author: schema.blogMembers.canAuthor,
	review: schema.blogMembers.canReview,
	comment: schema.blogMembers.canComment,
	admin: schema.blogMembers.canAdmin
} as const;

export type CapabilitySet = {
	canAuthor: boolean;
	canReview: boolean;
	canComment: boolean;
	canAdmin: boolean;
};

// Derive the capability booleans from a legacy role. This is the SAME mapping
// the 0007 migration backfill uses; keep them in lockstep. Used at every
// blog_members insert site so the columns stay consistent while `role` is still
// the write path (Phase 1). Once `role` is dropped, capabilities become the
// only write path and this collapses into setCapability.
export function capabilitiesForRole(role: MemberRole): CapabilitySet {
	return {
		canAuthor: role === 'owner' || role === 'editor' || role === 'author',
		canReview: role === 'owner' || role === 'editor' || role === 'reviewer',
		canComment: true, // every current role can comment
		canAdmin: role === 'owner'
	};
}

export async function listMembers(blogId: string) {
	const rows = await db
		.select({
			id: schema.blogMembers.id,
			role: schema.blogMembers.role,
			canAuthor: schema.blogMembers.canAuthor,
			canReview: schema.blogMembers.canReview,
			canComment: schema.blogMembers.canComment,
			canAdmin: schema.blogMembers.canAdmin,
			addedAt: schema.blogMembers.addedAt,
			user: {
				id: schema.users.id,
				username: schema.users.username,
				displayName: schema.users.displayName
			}
		})
		.from(schema.blogMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.blogMembers.userId))
		.where(and(eq(schema.blogMembers.blogId, blogId), isNull(schema.blogMembers.removedAt)));
	return rows;
}

// Public, unauthenticated roster of a blog's JOINED members — the visible
// anonymity set ("who could have written any post"). Intentionally NOT gated by
// owner/manage roles: this is meant to be readable by anyone. Exposes only
// non-sensitive fields (username, displayName, role, joinedAt) and NEVER email
// or pending/unaccepted invitations (those live in a separate `invitations`
// table that this function does not touch). Only active memberships
// (`removed_at IS NULL`) are returned. Structured so a per-blog visibility
// toggle could gate it later; for v1 it is always public.
export async function listPublicMembers(blogId: string) {
	const rows = await db
		.select({
			role: schema.blogMembers.role,
			// can_author is the authoritative "could have written a post" predicate
			// (the role label is lossy — it cannot represent a member whose
			// capabilities diverge from any single role word). Callers that build the
			// public author anonymity set MUST filter on this, not on `role`.
			canAuthor: schema.blogMembers.canAuthor,
			joinedAt: schema.blogMembers.addedAt,
			username: schema.users.username,
			displayName: schema.users.displayName
		})
		.from(schema.blogMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.blogMembers.userId))
		.where(and(eq(schema.blogMembers.blogId, blogId), isNull(schema.blogMembers.removedAt)))
		.orderBy(schema.blogMembers.addedAt);
	return rows;
}

export async function listMembersByRole(blogId: string, role: MemberRole) {
	const all = await listMembers(blogId);
	return all.filter((m) => m.role === role);
}

export async function getActiveMember(blogId: string, userId: string) {
	const rows = await db
		.select()
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function setRole(
	blogId: string,
	targetUserId: string,
	newRole: MemberRole,
	actingUserId: string
): Promise<void> {
	const existing = await getActiveMember(blogId, targetUserId);
	const wasProving = existing && PROVING.includes(existing.role);
	const willBeProving = PROVING.includes(newRole);

	await db.transaction(async (tx) => {
		if (existing) {
			await tx
				.update(schema.blogMembers)
				.set({ removedAt: new Date() })
				.where(eq(schema.blogMembers.id, existing.id));
		}
		await tx.insert(schema.blogMembers).values({
			blogId,
			userId: targetUserId,
			role: newRole,
			...capabilitiesForRole(newRole),
			addedBy: actingUserId
		});
	});

	// A role change can shift author-tree membership (and comment-tree membership
	// if this was a brand-new member, though setRole on an existing member keeps
	// comment membership since every role can comment). Refreshing both trees is
	// idempotent — refreshSnapshot is a no-op when that tree's root is unchanged —
	// so we refresh all rather than track which set was touched. `wasProving` /
	// `willBeProving` are retained only to skip the work when neither side ever
	// touched a proving capability.
	if (wasProving || willBeProving) {
		await refreshAllSnapshots(blogId);
	} else {
		// Even a non-proving change (e.g. commenter↔commenter) is a fresh active
		// row; refresh the comment tree so a newly-added commenter lands in it.
		await refreshSnapshot(blogId, 'comment');
	}

	// Pre-gen trigger (a): if this role grants can_review, warm the vote-token key
	// once the blog has >= 2 reviewer-capable members. Fire-and-forget; no-op below
	// the threshold or if a key already exists.
	if (capabilitiesForRole(newRole).canReview) pregenOnReviewerAdded(blogId);
}

// Read a single capability on a member's active row. Returns false when the
// user is not an active member of the blog. This is the capability-model
// equivalent of hasRole and the predicate the per-capability trees use.
export async function hasCapability(
	blogId: string,
	userId: string,
	capability: Capability
): Promise<boolean> {
	const column = CAPABILITY_COLUMN[capability];
	const rows = await db
		.select({ has: column })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt)
			)
		)
		.limit(1);
	return rows[0]?.has === true;
}

// Grant or revoke one capability on a member's active row, in place. Unlike
// setRole (which soft-removes + reinserts to change the single enum), a
// capability flip is an independent column update. Returns the member's
// capability set before and after so callers can write an attributed
// permission-change log (Phase 5). When the flipped capability backs a Semaphore
// tree (author/comment — NOT review/admin), the affected tree is refreshed so
// the leaf set reflects the change immediately.
//
// `role` is also re-derived to keep the legacy label coherent while it still
// exists (it is the union label closest to the capability set). This is a
// best-effort label only; capabilities are the source of truth.
export async function setCapability(
	blogId: string,
	targetUserId: string,
	capability: Capability,
	value: boolean
): Promise<{ before: CapabilitySet; after: CapabilitySet } | null> {
	const existing = await getActiveMember(blogId, targetUserId);
	if (!existing) return null;

	const before: CapabilitySet = {
		canAuthor: existing.canAuthor,
		canReview: existing.canReview,
		canComment: existing.canComment,
		canAdmin: existing.canAdmin
	};
	const after: CapabilitySet = { ...before };
	const field = (
		{
			author: 'canAuthor',
			review: 'canReview',
			comment: 'canComment',
			admin: 'canAdmin'
		} as const
	)[capability];
	after[field] = value;

	// No-op: nothing to write, no tree to refresh.
	if (before[field] === value) return { before, after };

	await db
		.update(schema.blogMembers)
		.set({ [field]: value, role: roleLabelFor(after) })
		.where(eq(schema.blogMembers.id, existing.id));

	// Only author/comment back a Semaphore tree; review (blind tokens) and admin
	// (session-auth) do not. Refresh exactly the affected tree.
	if (capability === 'author' || capability === 'comment') {
		await refreshSnapshot(blogId, capability);
	}

	// Pre-gen trigger (a): granting can_review may push the blog to >= 2
	// reviewer-capable members; warm the vote-token key. Fire-and-forget.
	if (capability === 'review' && value === true) pregenOnReviewerAdded(blogId);
	return { before, after };
}

// Derive the legacy single-word role label from a capability set. Picks the
// closest legacy union; used to keep blog_members.role coherent for RSS/llms.txt
// while the column still exists. Dropped with the column.
export function roleLabelFor(caps: CapabilitySet): MemberRole {
	if (caps.canAdmin) return 'owner';
	if (caps.canAuthor && caps.canReview) return 'editor';
	if (caps.canReview) return 'reviewer';
	if (caps.canAuthor) return 'author';
	return 'commenter';
}

export async function removeMember(blogId: string, targetUserId: string): Promise<void> {
	const existing = await getActiveMember(blogId, targetUserId);
	if (!existing) return;
	await db
		.update(schema.blogMembers)
		.set({ removedAt: new Date() })
		.where(eq(schema.blogMembers.id, existing.id));
	// A removed member drops out of every tree they were in. They always held
	// can_comment (universal) and may have held can_author, so refresh both trees.
	await refreshAllSnapshots(blogId);
}

// Count active members of a blog that hold can_admin. Used by the last-admin
// guard (D7/R9): the final admin can't be stripped of can_admin or removed.
export async function countAdmins(blogId: string): Promise<number> {
	const rows = await db
		.select({ id: schema.blogMembers.id })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				isNull(schema.blogMembers.removedAt),
				eq(schema.blogMembers.canAdmin, true)
			)
		);
	return rows.length;
}

// Count active members of a blog that hold can_review — the eligible-reviewer
// population (everyone who COULD be issued a vote token). Snapshotted onto a post
// version when it enters under_review to freeze the quorum denominator (see
// blog_post_versions.eligibleReviewersAtReview and evaluatePostReview). Accepts
// an optional transaction handle so the snapshot can be taken atomically with the
// status transition.
export async function countEligibleReviewers(
	blogId: string,
	tx: Pick<typeof db, 'select'> = db
): Promise<number> {
	const rows = await tx
		.select({ id: schema.blogMembers.id })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				isNull(schema.blogMembers.removedAt),
				eq(schema.blogMembers.canReview, true)
			)
		);
	return rows.length;
}

// The four capabilities a permission-change diff can touch.
export type CapabilityPatch = Partial<Record<Capability, boolean>>;

// Apply a capability diff to a member, enforcing the last-admin guard, and write
// BOTH logs (the internal audit_log via the caller, and the member-visible
// permission_changes here). Returns the before/after capability sets, or throws a
// SvelteKit error on a guard violation. The actor is recorded for attribution
// (these admin actions are deliberately non-anonymous).
//
// Last-admin guard: if the patch would remove can_admin from the blog's only
// remaining admin, it is rejected (error 409). Granting is always allowed.
export async function changeCapabilities(opts: {
	blogId: string;
	targetUserId: string;
	actorUserId: string;
	patch: CapabilityPatch;
}): Promise<{ before: CapabilitySet; after: CapabilitySet }> {
	const { error } = await import('@sveltejs/kit');
	const existing = await getActiveMember(opts.blogId, opts.targetUserId);
	if (!existing) throw error(404, 'target is not an active member');

	const before: CapabilitySet = {
		canAuthor: existing.canAuthor,
		canReview: existing.canReview,
		canComment: existing.canComment,
		canAdmin: existing.canAdmin
	};

	// Track the running capability set so the role label + the permission_changes
	// log reflect every applied change.
	let after: CapabilitySet = { ...before };

	// Admin REVOCATION is the only operation with a cross-row invariant (a blog
	// must keep >= 1 admin), so it must be atomic against a concurrent demotion.
	// We do the count-and-revoke inside ONE transaction that first locks every
	// active admin row of the blog (SELECT … FOR UPDATE): a second concurrent
	// demotion blocks on that lock until this txn commits, then re-counts and
	// correctly sees the reduced count — closing the check-then-act TOCTOU that a
	// plain countAdmins() + separate update would leave open (two demotions could
	// each read count=2 and both succeed, stranding the blog at zero admins).
	const revokingAdmin = opts.patch.admin === false && existing.canAdmin;
	if (revokingAdmin) {
		await db.transaction(async (tx) => {
			const adminRows = await tx
				.select({ id: schema.blogMembers.id })
				.from(schema.blogMembers)
				.where(
					and(
						eq(schema.blogMembers.blogId, opts.blogId),
						isNull(schema.blogMembers.removedAt),
						eq(schema.blogMembers.canAdmin, true)
					)
				)
				.for('update');
			// Re-count INSIDE the locked txn. <= 1 means the target is the last admin.
			if (adminRows.length <= 1) {
				throw error(409, 'cannot remove the last admin of this blog');
			}
			after.canAdmin = false;
			await tx
				.update(schema.blogMembers)
				.set({ canAdmin: false, role: roleLabelFor(after) })
				.where(eq(schema.blogMembers.id, existing.id));
		});
	}

	// Apply the remaining capability changes via setCapability (which refreshes the
	// right tree for author/comment and keeps the legacy role label coherent).
	// Admin is handled above when it is a revocation; an admin GRANT has no
	// cross-row invariant, so it flows through setCapability like the others.
	for (const cap of ['author', 'review', 'comment', 'admin'] as Capability[]) {
		if (cap === 'admin' && revokingAdmin) continue; // already applied atomically
		const want = opts.patch[cap];
		if (want === undefined) continue;
		const res = await setCapability(opts.blogId, opts.targetUserId, cap, want);
		if (res) after = res.after;
	}

	// Member-visible attributed log (NEVER IP/UA — design R8).
	await db.insert(schema.permissionChanges).values({
		blogId: opts.blogId,
		actorUserId: opts.actorUserId,
		subjectUserId: opts.targetUserId,
		oldCaps: before,
		newCaps: after
	});

	return { before, after };
}

// Member-visible permission change feed for a blog, newest first. Selects ONLY
// the safe columns (never IP/UA — there are none on this table) and resolves the
// actor/subject usernames for display.
export async function listPermissionChanges(blogId: string, limit = 50) {
	const actor = schema.users;
	const rows = await db
		.select({
			id: schema.permissionChanges.id,
			oldCaps: schema.permissionChanges.oldCaps,
			newCaps: schema.permissionChanges.newCaps,
			createdAt: schema.permissionChanges.createdAt,
			actorUserId: schema.permissionChanges.actorUserId,
			subjectUserId: schema.permissionChanges.subjectUserId
		})
		.from(schema.permissionChanges)
		.where(eq(schema.permissionChanges.blogId, blogId))
		.orderBy(desc(schema.permissionChanges.createdAt))
		.limit(limit);
	if (rows.length === 0) return [];

	// Resolve usernames for the actor + subject ids referenced.
	const ids = new Set<string>();
	for (const r of rows) {
		if (r.actorUserId) ids.add(r.actorUserId);
		if (r.subjectUserId) ids.add(r.subjectUserId);
	}
	const userRows = ids.size
		? await db
				.select({
					id: actor.id,
					username: actor.username,
					displayName: actor.displayName
				})
				.from(actor)
				.where(inArray(actor.id, [...ids]))
		: [];
	const nameOf = new Map(userRows.map((u) => [u.id, u.displayName?.trim() || u.username]));
	return rows.map((r) => ({
		id: r.id,
		oldCaps: r.oldCaps as CapabilitySet,
		newCaps: r.newCaps as CapabilitySet,
		createdAt: r.createdAt,
		actor: r.actorUserId ? (nameOf.get(r.actorUserId) ?? null) : null,
		subject: r.subjectUserId ? (nameOf.get(r.subjectUserId) ?? null) : null
	}));
}

export async function isFirstOwner(blogId: string, userId: string): Promise<boolean> {
	const rows = await db
		.select({ userId: schema.blogMembers.userId, addedAt: schema.blogMembers.addedAt })
		.from(schema.blogMembers)
		.where(and(eq(schema.blogMembers.blogId, blogId), eq(schema.blogMembers.role, 'owner')))
		.orderBy(schema.blogMembers.addedAt)
		.limit(1);
	return rows[0]?.userId === userId;
}

export { affectsProvingSet };
