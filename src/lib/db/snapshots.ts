import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import type { TreeCapability } from './schema';
import { createMembership, semaphoreEngine, currentSnapshot } from '@ministryofmany/membership';
import type {
	SemaphoreGroupProvider,
	SnapshotStore,
	MembershipSnapshot,
	TreeRef,
	EligibleLeaf,
	GetByRootResult,
	GetByRootOptions
} from '@ministryofmany/membership';

// FreedInk's membership layer, implemented over @ministryofmany/membership.
//
// The snapshot composition, root computation, the (context, subTree, root) R1
// pin, and proof verification all live in the package now. FreedInk supplies the
// two seams the package cannot know:
//   - a MerkleGroupProvider whose listEligible IS FreedInk's eligible-set query
//     (active members holding the capability × active device commitments), with
//     the exact (userCreatedAt, userId, deviceCreatedAt, idc) ordering emitted as
//     orderKeys so the package reproduces the byte-identical root; and
//   - a SnapshotStore over blog_member_snapshots (persisted rows, pinned to
//     (blog, capability, root)).
//
// This module keeps its former public surface (currentMembership, refreshSnapshot,
// refreshAllSnapshots, refreshSnapshotsForUser, getSnapshotByRoot) so every caller
// is unchanged; the bodies now delegate to the package.

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

// ─────────────────────────── MerkleGroupProvider (⊕ seam) ──────────────────────

// Build the deterministic, current eligible set for ONE capability tree of a
// blog: EVERY active (non-revoked) device commitment of each member that holds
// `capability`. Per-device model (Phase 3): a member contributes K leaves, one
// per enrolled device, so a 2-device member is provable from either device.
//
// Ordering (design D9 — deterministic, replica-independent, leaf-local): the
// orderKeys are [userCreatedAtMs, userId, deviceCreatedAtMs, idc]. The package's
// comparator selects numeric subtraction for the number keys (the ms timestamps,
// matching FreedInk's getTime() diff) and localeCompare for the string keys
// (userId / idc), reproducing FreedInk's former in-place sort EXACTLY. The types
// MUST stay number/string as here, or the comparator branch flips and the root
// drifts (making every stored snapshot unverifiable). This is the only place
// FreedInk's exclusion + ordering lives; the package composes the root over it.
const freedinkProvider: SemaphoreGroupProvider = {
	shape: { kind: 'dynamic' },
	engine: 'semaphore',
	async listEligible(ref: TreeRef): Promise<EligibleLeaf[]> {
		const blogId = ref.context;
		const capColumn = TREE_CAPABILITY_COLUMN[ref.subTree as TreeCapability];
		if (!capColumn) return [];

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
		// leaf === commitment === idc for Semaphore. The package sorts by orderKeys.
		return identityRows
			.filter((row) => userCreatedAt.has(row.userId))
			.map((row) => ({
				leaf: row.idc,
				commitment: row.idc,
				orderKeys: [
					userCreatedAt.get(row.userId)!.getTime(),
					row.userId,
					row.createdAt.getTime(),
					row.idc
				]
			}));
	}
};

// ─────────────────────────── SnapshotStore (⊕ seam) ────────────────────────────

// The raw blog_member_snapshots row for (blog, capability, root), or null. The R1
// authorization control: a proof's root is only honored against the tree it was
// frozen for. Kept exported (its former signature) because tests and the store's
// getByRoot both read it.
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

// Map a stored snapshot row to the package's MembershipSnapshot shape.
function rowToSnapshot(
	row: { id: string; root: string; identities: string[]; eligibleCount: number },
	ref: TreeRef
): MembershipSnapshot {
	return {
		ref,
		root: row.root,
		leaves: row.identities,
		eligibleCount: row.eligibleCount,
		snapshotId: row.id,
		shape: { kind: 'dynamic' },
		engine: 'semaphore'
	};
}

// FreedInk persists snapshots, so this is a real SnapshotStore (not the package's
// liveSnapshotStore). getByRoot fuses FreedInk's two former current-root
// behaviors behind the requireCurrentRoot flag (see the R4 note in
// server/semaphore.ts):
//   - requireCurrentRoot true  → the stored row is returned only if its root is
//     still the tree's CURRENT live root (recomputed once via the provider);
//     otherwise { found:false, stale:true } (a removed/rotated member on a stale
//     root is rejected).
//   - requireCurrentRoot false → any historical stored row of the same
//     (blog, capability) is honored (FreedInk's tolerant path).
const freedinkSnapshotStore: SnapshotStore = {
	async put(snapshot: MembershipSnapshot): Promise<MembershipSnapshot> {
		const blogId = snapshot.ref.context;
		const capability = snapshot.ref.subTree;
		const existing = await getSnapshotByRoot(blogId, capability as TreeCapability, snapshot.root);
		if (existing) return rowToSnapshot(existing, snapshot.ref);
		const [row] = await db
			.insert(schema.blogMemberSnapshots)
			.values({
				blogId,
				capability,
				root: snapshot.root,
				identities: snapshot.leaves,
				eligibleCount: snapshot.eligibleCount
			})
			.returning();
		return rowToSnapshot(row, snapshot.ref);
	},

	async getByRoot(
		ref: TreeRef,
		root: string,
		opts?: GetByRootOptions
	): Promise<GetByRootResult> {
		const row = await getSnapshotByRoot(ref.context, ref.subTree as TreeCapability, root);
		if (!row) return { found: false, stale: false };
		if (opts?.requireCurrentRoot) {
			// Recompute the live root for THIS tree (once) and reject a stale row: a
			// removed/rotated-away member must fail here even though the row exists.
			const live = await currentSnapshot(freedinkProvider, semaphoreEngine, ref);
			if (live.root !== root) return { found: false, stale: true };
		}
		return { found: true, snapshot: rowToSnapshot(row, ref) };
	}
};

// The composed membership over FreedInk's provider + persisted store, pinned to
// the (static) semaphore engine so the @ministryofmany/rln island is never pulled.
export const membership = createMembership({
	provider: freedinkProvider,
	store: freedinkSnapshotStore,
	engine: semaphoreEngine
});

// ─────────────────────────── Public surface (unchanged) ────────────────────────

function refOf(blogId: string, capability: TreeCapability): TreeRef {
	return { context: blogId, subTree: capability };
}

// The blog's CURRENT membership for ONE capability tree, derived live from the
// member rows (not from the newest snapshot row). Authoritative "current root".
export async function currentMembership(
	blogId: string,
	capability: TreeCapability
): Promise<{ root: string; identities: string[]; eligibleCount: number }> {
	const snap = await membership.current(refOf(blogId, capability));
	return { root: snap.root, identities: snap.leaves, eligibleCount: snap.eligibleCount };
}

// Insert a snapshot row for the current eligible state of ONE capability tree,
// idempotently (skips insert if a snapshot row with the same (blog, capability,
// root) already exists). `changed` reports whether a NEW row was inserted.
export async function refreshSnapshot(
	blogId: string,
	capability: TreeCapability
): Promise<{
	root: string;
	identities: string[];
	eligibleCount: number;
	changed: boolean;
}> {
	const ref = refOf(blogId, capability);
	const snap = await membership.current(ref);
	const existing = await getSnapshotByRoot(blogId, capability, snap.root);
	const changed = existing === null;
	if (changed) await freedinkSnapshotStore.put(snap);
	return {
		root: snap.root,
		identities: snap.leaves,
		eligibleCount: snap.eligibleCount,
		changed
	};
}

// Refresh every tree of a blog (author + comment). Used after a member is
// added/removed (affects potentially every tree) or a capability is granted on a
// path that doesn't know which single tree changed.
export async function refreshAllSnapshots(blogId: string): Promise<void> {
	for (const cap of TREE_CAPABILITIES) await refreshSnapshot(blogId, cap);
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
