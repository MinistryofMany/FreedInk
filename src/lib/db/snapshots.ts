import { db, schema } from './client';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import type { MemberRole } from './schema';

const PROVING: MemberRole[] = ['owner', 'editor', 'reviewer', 'author'];

// Build the deterministic, current proving-eligible set for a blog: each member's
// active (non-revoked) identity commitment, ordered strictly by USER creation
// time (oldest first). User creation time is stable across identity rotations,
// so a rotation by an older user doesn't shuffle the Merkle tree position of
// every newer user — only that user's leaf changes.
//
// Why not sort by IDC string? Because an identity rotation produces a brand-
// new IDC, which would reposition the user in an IDC-sorted tree and shift
// every other member's index. With user-creation-date ordering, rotations are
// local (one leaf updated) rather than global (whole tree re-shaped).
async function currentEligibleIdentities(blogId: string): Promise<string[]> {
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
				inArray(schema.blogMembers.role, PROVING)
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
		.where(
			and(
				inArray(schema.userIdentities.userId, userIds),
				eq(schema.userIdentities.status, 'active')
			)
		);

	// Pick the most recently created active identity per user (defensive: there
	// should only ever be one active row per user, but ordering is cheap).
	const byUser = new Map<string, string>();
	const byUserCreated = new Map<string, Date>();
	for (const row of identityRows) {
		const cur = byUserCreated.get(row.userId);
		if (!cur || row.createdAt > cur) {
			byUser.set(row.userId, row.idc);
			byUserCreated.set(row.userId, row.createdAt);
		}
	}

	// Sort by user creation date ASC, tiebreak by user id (UUID, stable string
	// comparison) so the order is fully deterministic.
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

// Insert a snapshot row for the current proving-eligible state, idempotently
// (skips insert if the latest snapshot already has the same root).
export async function refreshSnapshot(blogId: string): Promise<{
	root: string;
	identities: string[];
	eligibleCount: number;
	changed: boolean;
}> {
	const identities = await currentEligibleIdentities(blogId);
	const root = identities.length === 0 ? '0' : await rootOf(identities);
	const eligibleCount = identities.length;

	const existing = await db
		.select({ root: schema.blogMemberSnapshots.root })
		.from(schema.blogMemberSnapshots)
		.where(
			and(
				eq(schema.blogMemberSnapshots.blogId, blogId),
				eq(schema.blogMemberSnapshots.root, root)
			)
		)
		.limit(1);

	if (existing.length > 0) {
		return { root, identities, eligibleCount, changed: false };
	}

	await db.insert(schema.blogMemberSnapshots).values({
		blogId,
		root,
		identities,
		eligibleCount
	});
	return { root, identities, eligibleCount, changed: true };
}

export async function getSnapshotByRoot(blogId: string, root: string) {
	const rows = await db
		.select()
		.from(schema.blogMemberSnapshots)
		.where(
			and(eq(schema.blogMemberSnapshots.blogId, blogId), eq(schema.blogMemberSnapshots.root, root))
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function getLatestSnapshot(blogId: string) {
	const rows = await db
		.select()
		.from(schema.blogMemberSnapshots)
		.where(eq(schema.blogMemberSnapshots.blogId, blogId))
		.orderBy(schema.blogMemberSnapshots.createdAt)
		.limit(1);
	return rows[0] ?? null;
}

// Refresh every blog this user is a member of — used when the user rotates identity.
export async function refreshSnapshotsForUser(userId: string): Promise<void> {
	const rows = await db
		.selectDistinct({ blogId: schema.blogMembers.blogId })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt),
				inArray(schema.blogMembers.role, PROVING)
			)
		);
	for (const r of rows) await refreshSnapshot(r.blogId);
}
