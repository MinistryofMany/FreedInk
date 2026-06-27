import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import type { TreeCapability } from './schema';

// The capabilities that have their own Semaphore membership tree: author
// (writers) and comment (commenters). Votes use blind tokens (no reviewers tree)
// and admin is session-auth (no tree). Iterated for "refresh all of a blog's /
// user's trees".
export const TREE_CAPABILITIES: readonly TreeCapability[] = ['author', 'comment'];

// Capability → blog_members column, for the tree capabilities only. Defined here
// (rather than importing CAPABILITY_COLUMN from ./members) to avoid a circular
// import — members.ts imports refreshSnapshot from this module.
const TREE_CAPABILITY_COLUMN = {
	author: schema.blogMembers.canAuthor,
	comment: schema.blogMembers.canComment
} as const;

// Build the deterministic, current eligible set for ONE capability tree of a
// blog: EVERY active (non-revoked) device commitment of each member that holds
// `capability`. Per-device model (Phase 3): a member contributes K leaves, one
// per enrolled device, so a 2-device member is provable from either device.
//
// Ordering (design D9 — deterministic, replica-independent, leaf-local): sort by
//   (userCreatedAt ASC, userId ASC, deviceCreatedAt ASC, idc ASC)
// User creation time first keeps each member's leaves contiguous and stable
// across other members' changes; within a member, device-creation-then-idc keeps
// device order stable so adding/revoking ONE device is a local insert/delete
// rather than a reshuffle of the whole tree. The root is a pure function of the
// ordered commitment list, so any two replicas derive the identical root.
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

	// Map each eligible member to their stable user-creation time (for ordering).
	const userCreatedAt = new Map<string, Date>();
	for (const m of memberRows) userCreatedAt.set(m.userId, m.userCreatedAt);

	const identityRows = await db
		.select({
			userId: schema.userIdentities.userId,
			idc: schema.userIdentities.idc,
			createdAt: schema.userIdentities.createdAt
		})
		.from(schema.userIdentities)
		.where(eq(schema.userIdentities.status, 'active'));

	// Emit ALL active commitments of each eligible member (not one per user).
	const leaves = identityRows
		.filter((row) => userCreatedAt.has(row.userId))
		.map((row) => ({
			idc: row.idc,
			userId: row.userId,
			userCreatedAt: userCreatedAt.get(row.userId)!,
			deviceCreatedAt: row.createdAt
		}));

	leaves.sort((a, b) => {
		const t = a.userCreatedAt.getTime() - b.userCreatedAt.getTime();
		if (t !== 0) return t;
		if (a.userId !== b.userId) return a.userId.localeCompare(b.userId);
		const d = a.deviceCreatedAt.getTime() - b.deviceCreatedAt.getTime();
		if (d !== 0) return d;
		// Final tiebreak on the commitment string: total order even if two devices
		// share a created_at timestamp (e.g. bulk insert in tests).
		return a.idc.localeCompare(b.idc);
	});

	return leaves.map((l) => l.idc);
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
