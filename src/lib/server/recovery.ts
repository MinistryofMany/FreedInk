// Account recovery: email-mediated way back into an account whose only passkey
// was lost. We issue a short-lived single-use token to a *verified* email; the
// holder of that token can register a new passkey on the existing account.
//
// IMPORTANT: recovery restores account access (sessions, blogs, roles) but
// does NOT restore the user's Semaphore identity — the ciphertext blob is
// password-protected and only the user knows the password. Recovered users
// must rotate to a fresh identity from /settings if they want to post/vote/
// comment again.
import { db, schema } from '$lib/db/client';
import { and, eq, gt, isNull, count, sql } from 'drizzle-orm';
import { randomToken } from './session';
import { sendMail } from './email';
import { env as publicEnv } from '$env/dynamic/public';
import { log } from './log';
import type { User } from '$lib/db/schema';

const RECOVERY_TTL_MS = 30 * 60 * 1000; // 30 minutes
// Belt-and-suspenders ceiling. The proper rate limiter lives in rate-limit.ts;
// this is just to avoid an obvious abuse hole if someone forgot to wire it.
const MAX_OUTSTANDING_PER_HOUR = 3;

export type RecoveryRow = typeof schema.accountRecoveries.$inferSelect;

// Hit by /api/auth/recovery/start. Returns whether a token was actually
// issued (caller still always responds 200 to avoid email enumeration).
export async function startRecovery(opts: {
	email: string;
	ip?: string | null;
	userAgent?: string | null;
}): Promise<{ issued: boolean; token?: string }> {
	const normalized = opts.email.trim().toLowerCase();
	if (!normalized || !normalized.includes('@')) return { issued: false };

	const userRows = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.email, normalized))
		.limit(1);
	const user = userRows[0];
	// Silently no-op when there's no user OR no verified email — never reveal
	// to the caller which it was.
	if (!user || !user.emailVerifiedAt) return { issued: false };

	// Belt-and-suspenders: limit outstanding unconsumed recoveries per user.
	// The official rate-limit lives in `rate-limit.ts` (recoveryStart rule);
	// this guards against running without it.
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
	const recent = await db
		.select({ n: count() })
		.from(schema.accountRecoveries)
		.where(
			and(
				eq(schema.accountRecoveries.userId, user.id),
				isNull(schema.accountRecoveries.consumedAt),
				gt(schema.accountRecoveries.createdAt, oneHourAgo)
			)
		);
	const n = Number(recent[0]?.n ?? 0);
	if (n >= MAX_OUTSTANDING_PER_HOUR) {
		log.warn({ userId: user.id, n }, 'recovery: too many outstanding tokens; skipping');
		return { issued: false };
	}

	const token = randomToken();
	const expiresAt = new Date(Date.now() + RECOVERY_TTL_MS);
	await db.insert(schema.accountRecoveries).values({
		token,
		userId: user.id,
		requestedIp: opts.ip ?? null,
		requestedUserAgent: opts.userAgent ?? null,
		expiresAt
	});

	const origin = publicEnv.PUBLIC_ORIGIN ?? '';
	const link = `${origin}/recover?token=${token}`;
	try {
		await sendMail({
			to: user.email!,
			subject: 'Recover your Freed.Ink account',
			text:
				`Someone (hopefully you) requested account recovery for this email.\n\n` +
				`Open this link within 30 minutes to register a new passkey:\n\n${link}\n\n` +
				`After recovery, your old Semaphore identity remains revoked — you'll need to rotate ` +
				`to a new one from /settings before posting again.\n\n` +
				`If you didn't request this, ignore the email; the token expires automatically.`
		});
	} catch (err) {
		log.error({ err, userId: user.id }, 'recovery: sendMail failed');
		// Don't bubble — caller still treats this as success to avoid enumeration.
	}

	return { issued: true, token };
}

// Used by GET /verify and POST /options. Confirms the token exists, is
// unconsumed, and not expired. Returns the row + user, or null.
export async function lookupRecovery(token: string): Promise<{
	row: RecoveryRow;
	user: User;
} | null> {
	const rows = await db
		.select({ row: schema.accountRecoveries, user: schema.users })
		.from(schema.accountRecoveries)
		.innerJoin(schema.users, eq(schema.users.id, schema.accountRecoveries.userId))
		.where(
			and(
				eq(schema.accountRecoveries.token, token),
				isNull(schema.accountRecoveries.consumedAt),
				gt(schema.accountRecoveries.expiresAt, new Date())
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

// Mark a recovery token consumed. Idempotent in the sense that a second call
// returns false (because the where-clause no longer matches).
export async function consumeRecovery(token: string): Promise<boolean> {
	const updated = await db
		.update(schema.accountRecoveries)
		.set({ consumedAt: sql`now()` })
		.where(
			and(eq(schema.accountRecoveries.token, token), isNull(schema.accountRecoveries.consumedAt))
		)
		.returning({ token: schema.accountRecoveries.token });
	return updated.length === 1;
}
