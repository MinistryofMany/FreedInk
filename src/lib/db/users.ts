import { db, schema } from './client';
import { eq, sql } from 'drizzle-orm';
import type { User } from './schema';

export async function getUserById(id: string): Promise<User | null> {
	const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
	return rows[0] ?? null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
	const rows = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.username, username))
		.limit(1);
	return rows[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
	const rows = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.email, email.toLowerCase()))
		.limit(1);
	return rows[0] ?? null;
}

// Creates a bare user row with a username and an optional contact email. Sign-in
// is Tessera-only (see src/lib/db/oidc.ts:createUserWithOidcIdentity for the real
// account-creation path); this helper backs test factories and any flow that
// seeds a user without an OIDC identity.
export async function createUserWithEmail(email: string, username: string): Promise<User> {
	const inserted = await db
		.insert(schema.users)
		.values({ username, email: email.toLowerCase() })
		.returning();
	return inserted[0];
}

export async function updateUserProfile(
	userId: string,
	patch: { username?: string; displayName?: string | null }
): Promise<User | null> {
	const update: Record<string, unknown> = {};
	if (patch.username !== undefined) update.username = patch.username;
	if (patch.displayName !== undefined) update.displayName = patch.displayName;
	if (Object.keys(update).length === 0) return getUserById(userId);
	update.updatedAt = sql`now()`;
	const rows = await db
		.update(schema.users)
		.set(update)
		.where(eq(schema.users.id, userId))
		.returning();
	return rows[0] ?? null;
}
