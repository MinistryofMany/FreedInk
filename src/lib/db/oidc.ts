import { db, schema } from './client';
import { and, eq } from 'drizzle-orm';
import type { User } from './schema';

// The OIDC subject(s) linked to a user, newest link first. Used to surface the
// operator's own Minister `sub` in the ops UI / Settings so they can pin it into
// FREEDINK_OPERATOR_SUBS. A user normally has exactly one (Minister is the only
// OIDC issuer today), but the schema permits several.
export async function getOidcSubjectsForUser(
	userId: string
): Promise<Array<{ issuer: string; subject: string }>> {
	return db
		.select({ issuer: schema.oidcIdentities.issuer, subject: schema.oidcIdentities.subject })
		.from(schema.oidcIdentities)
		.where(eq(schema.oidcIdentities.userId, userId))
		.orderBy(schema.oidcIdentities.linkedAt);
}

export async function getUserByOidcIdentity(issuer: string, subject: string): Promise<User | null> {
	const rows = await db
		.select({ user: schema.users })
		.from(schema.oidcIdentities)
		.innerJoin(schema.users, eq(schema.users.id, schema.oidcIdentities.userId))
		.where(
			and(eq(schema.oidcIdentities.issuer, issuer), eq(schema.oidcIdentities.subject, subject))
		)
		.limit(1);
	return rows[0]?.user ?? null;
}

export async function linkOidcIdentityToUser(
	userId: string,
	issuer: string,
	subject: string
): Promise<void> {
	await db
		.insert(schema.oidcIdentities)
		.values({ userId, issuer, subject })
		.onConflictDoNothing({
			target: [schema.oidcIdentities.issuer, schema.oidcIdentities.subject]
		});
}

export async function createUserWithOidcIdentity(
	issuer: string,
	subject: string,
	opts: { displayName?: string } = {}
): Promise<User> {
	// Minister discloses only a pairwise `sub` (+ optional display name/avatar)
	// over OIDC — no username or email. Mint a unique placeholder username
	// derived from the subject; the user can rename later from settings, the
	// same way the wallet sign-in path seeds a `0x…` placeholder.
	const username = `minister-${subject.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`;
	const [user] = await db
		.insert(schema.users)
		.values({ username, displayName: opts.displayName ?? null })
		.returning();
	await db.insert(schema.oidcIdentities).values({ userId: user.id, issuer, subject });
	return user;
}
