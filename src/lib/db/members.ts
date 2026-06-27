import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import type { MemberRole } from './schema';
import { refreshSnapshot } from './snapshots';

const PROVING: MemberRole[] = ['owner', 'editor', 'reviewer', 'author'];

function affectsProvingSet(...roles: MemberRole[]) {
	return roles.some((r) => PROVING.includes(r));
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
			addedBy: actingUserId
		});
	});

	if (wasProving || willBeProving) {
		await refreshSnapshot(blogId);
	}
}

export async function removeMember(blogId: string, targetUserId: string): Promise<void> {
	const existing = await getActiveMember(blogId, targetUserId);
	if (!existing) return;
	await db
		.update(schema.blogMembers)
		.set({ removedAt: new Date() })
		.where(eq(schema.blogMembers.id, existing.id));
	if (PROVING.includes(existing.role)) {
		await refreshSnapshot(blogId);
	}
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
