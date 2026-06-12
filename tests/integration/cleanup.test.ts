// Verify the cleanup reaper deletes expired rows and leaves fresh ones alone.
// We seed each target table with one stale and one fresh row, run the reaper,
// then assert the stale ones are gone and the fresh ones survive.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { runCleanupOnce } from '../../scripts/cleanup';
import { db, schema } from '$lib/db/client';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';

const PAST = new Date(Date.now() - 60_000); // 1 min in the past
const FUTURE = new Date(Date.now() + 60 * 60_000); // 1 hr in the future

// Use a dedicated short-lived client for the reaper — runCleanupOnce expects
// to own its `sql` handle.
const url = process.env.DATABASE_URL!;
let sql: ReturnType<typeof postgres>;

beforeAll(() => {
	sql = postgres(url, { max: 2, prepare: false });
});
afterAll(async () => {
	await sql.end();
});

describe('runCleanupOnce', () => {
	it('reaps expired ephemeral rows and preserves fresh ones', async () => {
		// Some target tables (rate_limits, account_recoveries, post_submission_nonces,
		// blog_invitations) aren't in the standard test truncate list, so previous
		// api / integration runs can leave rows behind in the shared test DB. Wipe
		// them up-front so our deltas are exact.
		await sql`TRUNCATE TABLE rate_limits, account_recoveries, post_submission_nonces, blog_invitations RESTART IDENTITY CASCADE`;

		// ─── seed: a user + a blog so we can reference them via FK ───
		const user = await createUserWithEmail('reaper@example.com', 'reaperuser');
		const blog = await createBlog(user.id, 'reaper blog', null);

		// sessions: 1 expired, 1 fresh
		const [staleSess] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, expiresAt: PAST })
			.returning({ id: schema.sessions.id });
		const [freshSess] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, expiresAt: FUTURE })
			.returning({ id: schema.sessions.id });

		// siwe_nonces: 1 expired, 1 consumed, 1 fresh
		await db.insert(schema.siweNonces).values([
			{ nonce: 'siwe-stale', expiresAt: PAST },
			{ nonce: 'siwe-consumed', expiresAt: FUTURE, consumedAt: new Date() },
			{ nonce: 'siwe-fresh', expiresAt: FUTURE }
		]);

		// webauthn_challenges: 1 stale, 1 fresh
		await db.insert(schema.webauthnChallenges).values([
			{ challenge: 'wac-stale', kind: 'auth', expiresAt: PAST },
			{ challenge: 'wac-fresh', kind: 'auth', expiresAt: FUTURE }
		]);

		// email_verifications: 1 expired, 1 consumed, 1 fresh
		await db.insert(schema.emailVerifications).values([
			{ token: 'ev-stale', userId: user.id, email: 'reaper@example.com', expiresAt: PAST },
			{
				token: 'ev-consumed',
				userId: user.id,
				email: 'reaper@example.com',
				expiresAt: FUTURE,
				consumedAt: new Date()
			},
			{ token: 'ev-fresh', userId: user.id, email: 'reaper@example.com', expiresAt: FUTURE }
		]);

		// post_submission_nonces: 1 expired, 1 consumed, 1 fresh
		await db.insert(schema.postSubmissionNonces).values([
			{ nonce: 'psn-stale', blogId: blog.id, userId: user.id, expiresAt: PAST },
			{
				nonce: 'psn-consumed',
				blogId: blog.id,
				userId: user.id,
				expiresAt: FUTURE,
				consumedAt: new Date()
			},
			{ nonce: 'psn-fresh', blogId: blog.id, userId: user.id, expiresAt: FUTURE }
		]);

		// account_recoveries: 1 expired, 1 consumed, 1 fresh
		await db.insert(schema.accountRecoveries).values([
			{ token: 'rec-stale', userId: user.id, expiresAt: PAST },
			{ token: 'rec-consumed', userId: user.id, expiresAt: FUTURE, consumedAt: new Date() },
			{ token: 'rec-fresh', userId: user.id, expiresAt: FUTURE }
		]);

		// rate_limits: 1 expired, 1 fresh
		await db.insert(schema.rateLimits).values([
			{ key: 'rl-stale', windowStart: PAST, count: 1, expiresAt: PAST },
			{ key: 'rl-fresh', windowStart: new Date(), count: 1, expiresAt: FUTURE }
		]);

		// blog_invitations: 1 revoked (unaccepted), 1 expired, 1 accepted (kept),
		// 1 fresh pending
		await db.insert(schema.blogInvitations).values([
			{
				blogId: blog.id,
				invitedByUserId: user.id,
				email: 'a@x.com',
				role: 'author',
				token: 'inv-revoked',
				expiresAt: FUTURE,
				revokedAt: new Date()
			},
			{
				blogId: blog.id,
				invitedByUserId: user.id,
				email: 'b@x.com',
				role: 'author',
				token: 'inv-expired',
				expiresAt: PAST
			},
			{
				blogId: blog.id,
				invitedByUserId: user.id,
				email: 'c@x.com',
				role: 'author',
				token: 'inv-accepted',
				expiresAt: PAST, // expired AND accepted — should be kept
				acceptedAt: new Date(),
				acceptedByUserId: user.id
			},
			{
				blogId: blog.id,
				invitedByUserId: user.id,
				email: 'd@x.com',
				role: 'author',
				token: 'inv-fresh',
				expiresAt: FUTURE
			}
		]);

		// ─── run reaper ───
		const stats = await runCleanupOnce(sql);

		// ─── assertions ───
		expect(stats.sessions).toBe(1);
		expect(stats.siwe_nonces).toBe(2);
		expect(stats.webauthn_challenges).toBe(1);
		expect(stats.email_verifications).toBe(2);
		expect(stats.post_submission_nonces).toBe(2);
		expect(stats.account_recoveries).toBe(2);
		expect(stats.rate_limits).toBe(1);
		expect(stats.blog_invitations).toBe(2); // revoked + expired-unaccepted

		// Fresh rows survive.
		const sess = await sql`SELECT id FROM sessions ORDER BY expires_at`;
		expect(sess.map((r) => r.id)).toEqual([freshSess.id]);
		expect(sess.map((r) => r.id)).not.toContain(staleSess.id);

		const nonces = await sql`SELECT nonce FROM siwe_nonces`;
		expect(nonces.map((r) => r.nonce)).toEqual(['siwe-fresh']);

		const chals = await sql`SELECT challenge FROM webauthn_challenges`;
		expect(chals.map((r) => r.challenge)).toEqual(['wac-fresh']);

		const evs = await sql`SELECT token FROM email_verifications`;
		expect(evs.map((r) => r.token)).toEqual(['ev-fresh']);

		const psns = await sql`SELECT nonce FROM post_submission_nonces`;
		expect(psns.map((r) => r.nonce)).toEqual(['psn-fresh']);

		const recs = await sql`SELECT token FROM account_recoveries`;
		expect(recs.map((r) => r.token)).toEqual(['rec-fresh']);

		const rls = await sql`SELECT key FROM rate_limits`;
		expect(rls.map((r) => r.key)).toEqual(['rl-fresh']);

		const invs = await sql`SELECT token FROM blog_invitations ORDER BY token`;
		expect(invs.map((r) => r.token).sort()).toEqual(['inv-accepted', 'inv-fresh']);
	});

	it('returns zero counts when there is nothing to reap', async () => {
		// resetDb fired in beforeEach (integration setupFiles); tables are empty.
		// Wipe the ones beforeEach doesn't cover so we get a clean baseline.
		await sql`TRUNCATE TABLE rate_limits, account_recoveries, post_submission_nonces, blog_invitations RESTART IDENTITY CASCADE`;
		const stats = await runCleanupOnce(sql);
		expect(stats).toEqual({
			sessions: 0,
			siwe_nonces: 0,
			webauthn_challenges: 0,
			email_verifications: 0,
			post_submission_nonces: 0,
			account_recoveries: 0,
			rate_limits: 0,
			blog_invitations: 0,
			status_checks: 0
		});
	});

	it('reaps status_checks rows older than 90 days', async () => {
		// Seed three rows: one well beyond the retention window, one right on
		// the edge (kept), and one fresh (kept).
		await sql`TRUNCATE TABLE status_checks RESTART IDENTITY`;
		const veryOld = new Date(Date.now() - 100 * 86_400_000);
		const recent = new Date(Date.now() - 5 * 86_400_000);
		const now = new Date();
		await sql`INSERT INTO status_checks (checked_at, component, level, latency_ms) VALUES
			(${veryOld}, 'app', 'operational', 10),
			(${recent}, 'app', 'operational', 10),
			(${now}, 'app', 'operational', 10)
		`;

		const stats = await runCleanupOnce(sql);
		expect(stats.status_checks).toBe(1);

		const remaining = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM status_checks`;
		expect(remaining[0]?.count).toBe(2);
	});
});
