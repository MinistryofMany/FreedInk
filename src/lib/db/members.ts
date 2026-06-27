import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import type { MemberRole, Capability } from './schema';
import { refreshSnapshot, refreshAllSnapshots } from './snapshots';

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
