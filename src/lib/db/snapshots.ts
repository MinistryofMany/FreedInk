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
//     (active members holding the capability × their per-blog commitment), with
//     the exact (userCreatedAt, userId, deviceCreatedAt, idc) ordering emitted as
//     orderKeys so the package reproduces the byte-identical root; and
//   - a SnapshotStore over blog_member_snapshots (persisted rows, pinned to
//     (blog, capability, root)).
//
// Both seams are built over an EXECUTOR (the shared `db`, or a transaction) so a
// leaf write and its snapshot refresh can be folded into one atomic transaction
// (audit W5 prerequisite for re-key: blog_member_snapshots is append-only).

// A Drizzle handle: the shared connection or an open transaction. Only the query
// builders the seams use are required, so a `db.transaction` `tx` satisfies it.
type Executor = Pick<typeof db, 'select' | 'insert'>;

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
// blog: the active (non-revoked) per-blog commitment of each member that holds
// `capability`. One-root model: a member has exactly one active commitment PER
// BLOG (derived from their Ministry branch), so this is one leaf per member.
//
// Ordering (design D9 — deterministic, replica-independent, leaf-local): the
// orderKeys are [userCreatedAtMs, userId, deviceCreatedAtMs, idc]. The package's
// comparator selects numeric subtraction for the number keys (the ms timestamps)
// and localeCompare for the string keys (userId / idc), reproducing FreedInk's
// former in-place sort EXACTLY. The types MUST stay number/string as here.
function buildProvider(exec: Executor): SemaphoreGroupProvider {
	return {
		shape: { kind: 'dynamic' },
		engine: 'semaphore',
		async listEligible(ref: TreeRef): Promise<EligibleLeaf[]> {
			const blogId = ref.context;
			const capColumn = TREE_CAPABILITY_COLUMN[ref.subTree as TreeCapability];
			if (!capColumn) return [];

			const memberRows = await exec
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

			// The per-blog active commitments. Scoping by blogId here is both correct
			// (a leaf belongs to exactly one blog now) and a fix for the former
			// all-identities full scan.
			const identityRows = await exec
				.select({
					userId: schema.userIdentities.userId,
					idc: schema.userIdentities.idc,
					createdAt: schema.userIdentities.createdAt
				})
				.from(schema.userIdentities)
				.where(
					and(
						eq(schema.userIdentities.blogId, blogId),
						eq(schema.userIdentities.status, 'active')
					)
				);

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
}

// ─────────────────────────── SnapshotStore (⊕ seam) ────────────────────────────

// The raw blog_member_snapshots row for (blog, capability, root), or null. The R1
// authorization control: a proof's root is only honored against the tree it was
// frozen for. Kept exported (its former signature, with an optional executor)
// because tests and the store's getByRoot both read it.
export async function getSnapshotByRoot(
	blogId: string,
	capability: TreeCapability,
	root: string,
	exec: Executor = db
) {
	const rows = await exec
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
//     otherwise { found:false, stale:true }.
//   - requireCurrentRoot false → any historical stored row of the same
//     (blog, capability) is honored.
function buildStore(exec: Executor): SnapshotStore {
	return {
		async put(snapshot: MembershipSnapshot): Promise<MembershipSnapshot> {
			const blogId = snapshot.ref.context;
			const capability = snapshot.ref.subTree;
			const existing = await getSnapshotByRoot(
				blogId,
				capability as TreeCapability,
				snapshot.root,
				exec
			);
			if (existing) return rowToSnapshot(existing, snapshot.ref);
			const [row] = await exec
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

		async getByRoot(ref: TreeRef, root: string, opts?: GetByRootOptions): Promise<GetByRootResult> {
			const row = await getSnapshotByRoot(ref.context, ref.subTree as TreeCapability, root, exec);
			if (!row) return { found: false, stale: false };
			if (opts?.requireCurrentRoot) {
				// Recompute the live root for THIS tree (once) and reject a stale row: a
				// removed/rotated-away member must fail here even though the row exists.
				const live = await currentSnapshot(buildProvider(exec), semaphoreEngine, ref);
				if (live.root !== root) return { found: false, stale: true };
			}
			return { found: true, snapshot: rowToSnapshot(row, ref) };
		}
	};
}

// The composed membership over an executor's provider + persisted store, pinned to
// the (static) semaphore engine so the @ministryofmany/rln island is never pulled.
function membershipOver(exec: Executor) {
	return createMembership({
		provider: buildProvider(exec),
		store: buildStore(exec),
		engine: semaphoreEngine
	});
}

// The default (shared-connection) membership. Used by the verify path
// (server/semaphore.ts) and by reads.
export const membership = membershipOver(db);

// ─────────────────────────── Public surface ────────────────────────

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
// root) already exists). `changed` reports whether a NEW row was inserted. Pass
// `exec` (a transaction) to fold the refresh into a surrounding atomic write.
export async function refreshSnapshot(
	blogId: string,
	capability: TreeCapability,
	exec: Executor = db
): Promise<{
	root: string;
	identities: string[];
	eligibleCount: number;
	changed: boolean;
}> {
	const ref = refOf(blogId, capability);
	const m = membershipOver(exec);
	const snap = await m.current(ref);
	const existing = await getSnapshotByRoot(blogId, capability, snap.root, exec);
	const changed = existing === null;
	if (changed) await buildStore(exec).put(snap);
	return {
		root: snap.root,
		identities: snap.leaves,
		eligibleCount: snap.eligibleCount,
		changed
	};
}

// Refresh every tree of a blog (author + comment). Used after a member is
// added/removed, or after a leaf enroll/replace. Pass `exec` to run inside a
// transaction alongside the leaf write.
export async function refreshAllSnapshots(blogId: string, exec: Executor = db): Promise<void> {
	for (const cap of TREE_CAPABILITIES) await refreshSnapshot(blogId, cap, exec);
}

// Refresh every capability tree of every blog this user is a member of — used
// when a user's membership changes. refreshSnapshot is a no-op when that tree's
// root didn't actually change.
export async function refreshSnapshotsForUser(userId: string): Promise<void> {
	const rows = await db
		.selectDistinct({ blogId: schema.blogMembers.blogId })
		.from(schema.blogMembers)
		.where(and(eq(schema.blogMembers.userId, userId), isNull(schema.blogMembers.removedAt)));
	for (const r of rows) await refreshAllSnapshots(r.blogId);
}
