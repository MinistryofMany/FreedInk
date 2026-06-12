import { db, schema } from './client';
import { and, eq, sql } from 'drizzle-orm';
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

export async function getUserByWalletAddress(address: string): Promise<User | null> {
	const rows = await db
		.select({ user: schema.users })
		.from(schema.walletAddresses)
		.innerJoin(schema.users, eq(schema.users.id, schema.walletAddresses.userId))
		.where(eq(schema.walletAddresses.address, address.toLowerCase()))
		.limit(1);
	return rows[0]?.user ?? null;
}

export async function createUserWithWallet(
	address: string,
	username?: string
): Promise<User> {
	const normalized = address.toLowerCase();
	const placeholder = username ?? `0x${normalized.slice(2, 10)}`;
	const inserted = await db
		.insert(schema.users)
		.values({ username: placeholder })
		.returning();
	const user = inserted[0];
	await db.insert(schema.walletAddresses).values({ userId: user.id, address: normalized });
	return user;
}

export async function createUserWithEmail(email: string, username: string): Promise<User> {
	const inserted = await db
		.insert(schema.users)
		.values({ username, email: email.toLowerCase() })
		.returning();
	return inserted[0];
}

export async function linkWalletToUser(userId: string, address: string): Promise<void> {
	const normalized = address.toLowerCase();
	await db
		.insert(schema.walletAddresses)
		.values({ userId, address: normalized })
		.onConflictDoNothing({ target: schema.walletAddresses.address });
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

export async function markEmailVerified(userId: string): Promise<void> {
	await db
		.update(schema.users)
		.set({ emailVerifiedAt: sql`now()`, updatedAt: sql`now()` })
		.where(eq(schema.users.id, userId));
}

export async function getUserWallets(userId: string) {
	return db
		.select()
		.from(schema.walletAddresses)
		.where(eq(schema.walletAddresses.userId, userId));
}

export async function getUserPasskeys(userId: string) {
	return db
		.select({
			id: schema.passkeyCredentials.id,
			nickname: schema.passkeyCredentials.nickname,
			createdAt: schema.passkeyCredentials.createdAt,
			lastUsedAt: schema.passkeyCredentials.lastUsedAt
		})
		.from(schema.passkeyCredentials)
		.where(eq(schema.passkeyCredentials.userId, userId));
}
