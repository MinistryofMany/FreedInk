import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import type { TreeCapability } from './schema';

// The capabilities that have their own Semaphore membership tree. 'author' and
// 'comment' are the end-state trees; 'review' is TRANSITIONAL (Phases 2–4) so the
// existing review endpoint keeps proving membership unchanged until Phase 5
// swaps votes to blind tokens, at which point 'review' is removed here. 'admin'
// is never a tree (session-auth). Iterated for "refresh all of a blog's / user's
// trees".
export const TREE_CAPABILITIES: readonly TreeCapability[] = ['author', 'comment', 'review'];

// Capability → blog_members column, for the tree capabilities only. Defined here
// (rather than importing CAPABILITY_COLUMN from ./members) to avoid a circular
// import — members.ts imports refreshSnapshot from this module.
const TREE_CAPABILITY_COLUMN = {
	author: schema.blogMembers.canAuthor,
	comment: schema.blogMembers.canComment,
	review: schema.blogMembers.canReview
} as const;

// Build the deterministic, current eligible set for ONE capability tree of a
// blog: the active (non-revoked) identity commitment of each member that holds
// `capability`, ordered strictly by USER creation time (oldest first, tiebreak
// user id). User creation time is stable across identity rotations, so a
// rotation by an older user doesn't shuffle the Merkle tree position of every
// newer user — only that user's leaf changes.
//
// Phase 2 keeps the one-commitment-per-user shape (multi-device is Phase 3);
// the only change from the legacy single mixed group is the membership
// predicate, which is now the capability column rather than role ∈ PROVING.
async function currentEligibleIdentities(
	blogId: string,
	capability: TreeCapability
): Promise<string[]> {
	const capColumn = TREE_CAPABILITY_COLUMN[capability];
	const memberRows = await db
		.select({
			userId: schema.blogMembers.userId,
			userCreatedAt: schema.users.createdAt
		})
		.from(schema.blogMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.blogMembers.userId))
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				isNull(schema.blogMembers.removedAt),
				eq(capColumn, true)
			)
		);
	if (memberRows.length === 0) return [];

	const userIds = memberRows.map((r) => r.userId);
	const identityRows = await db
		.select({
			userId: schema.userIdentities.userId,
			idc: schema.userIdentities.idc,
			createdAt: schema.userIdentities.createdAt
		})
		.from(schema.userIdentities)
		.where(eq(schema.userIdentities.status, 'active'));

	// Pick the most recently created active identity per user (Phase 2: still one
	// leaf per user; Phase 3 emits all active commitments). Filter to this tree's
	// members.
	const memberSet = new Set(userIds);
	const byUser = new Map<string, string>();
	const byUserCreated = new Map<string, Date>();
	for (const row of identityRows) {
		if (!memberSet.has(row.userId)) continue;
		const cur = byUserCreated.get(row.userId);
		if (!cur || row.createdAt > cur) {
			byUser.set(row.userId, row.idc);
			byUserCreated.set(row.userId, row.createdAt);
		}
	}

	// Sort by user creation date ASC, tiebreak by user id (UUID, stable string
	// comparison) so the order is fully deterministic and replica-independent.
	const sorted = memberRows
		.filter((m) => byUser.has(m.userId))
		.slice()
		.sort((a, b) => {
			const t = a.userCreatedAt.getTime() - b.userCreatedAt.getTime();
			return t !== 0 ? t : a.userId.localeCompare(b.userId);
		});
	return sorted.map((m) => byUser.get(m.userId)!);
}

async function rootOf(identities: string[]): Promise<string> {
	// Lazy-load to keep the proof-system WASM out of SSR-time module evaluation.
	const { Group } = await import('@semaphore-protocol/group');
	const g = new Group();
	for (const idc of identities) g.addMember(BigInt(idc));
	return g.root.toString();
}

// The blog's CURRENT membership for ONE capability tree, derived live from the
// member rows (not from the newest snapshot row). This is the authoritative
// "current root" for that tree: it is exactly what the client proves against via
// the group endpoint / refreshSnapshot, and it stays correct even when membership
// cycles back to a prior set. Read-only — inserts nothing.
export async function currentMembership(
	blogId: string,
	capability: TreeCapability
): Promise<{ root: string; identities: string[]; eligibleCount: number }> {
	const identities = await currentEligibleIdentities(blogId, capability);
	const root = identities.length === 0 ? '0' : await rootOf(identities);
	return { root, identities, eligibleCount: identities.length };
}

// Insert a snapshot row for the current eligible state of ONE capability tree,
// idempotently (skips insert if a snapshot row with the same (blog, capability,
// root) already exists).
export async function refreshSnapshot(
	blogId: string,
	capability: TreeCapability
): Promise<{
	root: string;
	identities: string[];
	eligibleCount: number;
	changed: boolean;
}> {
	const { root, identities, eligibleCount } = await currentMembership(blogId, capability);

	const existing = await db
		.select({ root: schema.blogMemberSnapshots.root })
		.from(schema.blogMemberSnapshots)
		.where(
			and(
				eq(schema.blogMemberSnapshots.blogId, blogId),
				eq(schema.blogMemberSnapshots.capability, capability),
				eq(schema.blogMemberSnapshots.root, root)
			)
		)
		.limit(1);

	if (existing.length > 0) {
		return { root, identities, eligibleCount, changed: false };
	}

	await db.insert(schema.blogMemberSnapshots).values({
		blogId,
		capability,
		root,
		identities,
		eligibleCount
	});
	return { root, identities, eligibleCount, changed: true };
}

// Refresh every tree of a blog (author + comment). Used after a member is
// added/removed (affects potentially every tree) or a capability is granted on a
// path that doesn't know which single tree changed.
export async function refreshAllSnapshots(blogId: string): Promise<void> {
	for (const cap of TREE_CAPABILITIES) await refreshSnapshot(blogId, cap);
}

export async function getSnapshotByRoot(blogId: string, capability: TreeCapability, root: string) {
	const rows = await db
		.select()
		.from(schema.blogMemberSnapshots)
		.where(
			and(
				eq(schema.blogMemberSnapshots.blogId, blogId),
				eq(schema.blogMemberSnapshots.capability, capability),
				eq(schema.blogMemberSnapshots.root, root)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

// Refresh every capability tree of every blog this user is a member of — used
// when the user enrolls or revokes a device (Phase 3) or rotates identity. We
// refresh all tree capabilities of each blog the user belongs to; refreshSnapshot
// is a no-op when that tree's root didn't actually change.
export async function refreshSnapshotsForUser(userId: string): Promise<void> {
	const rows = await db
		.selectDistinct({ blogId: schema.blogMembers.blogId })
		.from(schema.blogMembers)
		.where(and(eq(schema.blogMembers.userId, userId), isNull(schema.blogMembers.removedAt)));
	for (const r of rows) await refreshAllSnapshots(r.blogId);
}
