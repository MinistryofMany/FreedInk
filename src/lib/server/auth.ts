import { error, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import type { MemberRole, User } from '$lib/db/schema';

export function requireUser(locals: App.Locals): User {
	if (!locals.user) throw redirect(303, '/signup');
	return locals.user;
}

export async function requireRole(
	blogId: string,
	userId: string,
	roles: readonly MemberRole[]
): Promise<MemberRole> {
	const rows = await db
		.select({ role: schema.blogMembers.role })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt),
				inArray(schema.blogMembers.role, roles as MemberRole[])
			)
		);
	if (rows.length === 0) throw error(403, 'forbidden');
	return rows[0].role;
}

export async function hasRole(
	blogId: string,
	userId: string,
	roles: readonly MemberRole[]
): Promise<boolean> {
	const rows = await db
		.select({ id: schema.blogMembers.id })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt),
				inArray(schema.blogMembers.role, roles as MemberRole[])
			)
		)
		.limit(1);
	return rows.length > 0;
}

export const ROLES_PROVING: readonly MemberRole[] = ['owner', 'editor', 'reviewer', 'author'];
export const ROLES_MANAGING: readonly MemberRole[] = ['owner'];
export const ROLES_REVIEWING: readonly MemberRole[] = ['owner', 'editor', 'reviewer'];
export const ROLES_WRITING: readonly MemberRole[] = ['owner', 'editor', 'author'];
export const ROLES_COMMENTING: readonly MemberRole[] = [
	'owner',
	'editor',
	'reviewer',
	'author',
	'commenter'
];
