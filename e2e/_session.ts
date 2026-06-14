// e2e auth seam for a Minister-only world.
//
// Sign-in is "Sign in with Minister" (OIDC) only, and there's no live Minister
// IdP in the e2e harness. Rather than mock the whole OIDC round-trip, we seed a
// user + session row straight into the shared test DB and hand the browser the
// signed `sid` cookie the app would have issued. The cookie format mirrors
// src/lib/server/session.ts:packCookie — `${sessionId}.${HMAC_SHA256(secret)}`.
import '../tests/setup/load-env';
import type { Page } from '@playwright/test';
import postgres from 'postgres';
import { createHmac, randomUUID } from 'node:crypto';

const COOKIE_NAME = 'sid';

export async function seedUserSession(opts: {
	username: string;
	email?: string | null;
}): Promise<{ userId: string; username: string; cookie: string }> {
	const url = process.env.DATABASE_URL;
	const secret = process.env.SESSION_SECRET;
	if (!url || !secret) throw new Error('DATABASE_URL / SESSION_SECRET missing in e2e env');

	const sql = postgres(url, { max: 1, prepare: false });
	try {
		const userId = randomUUID();
		await sql`INSERT INTO users (id, username, email)
			VALUES (${userId}, ${opts.username}, ${opts.email ?? null})`;
		const sessionId = randomUUID();
		const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
		await sql`INSERT INTO sessions (id, user_id, expires_at)
			VALUES (${sessionId}, ${userId}, ${expiresAt})`;
		const sig = createHmac('sha256', secret).update(sessionId).digest('base64url');
		return { userId, username: opts.username, cookie: `${sessionId}.${sig}` };
	} finally {
		await sql.end();
	}
}

// Seed a fresh signed-in user (no Semaphore identity yet) and attach the
// session cookie to the browser context. Mirrors what a first Minister sign-in
// produces: the user lands authenticated but still needs to set up an identity.
export async function signInAsNewUser(
	page: Page,
	opts: { username: string; email?: string | null }
): Promise<{ userId: string; username: string }> {
	const { userId, username, cookie } = await seedUserSession(opts);
	await page.context().addCookies([
		{
			name: COOKIE_NAME,
			value: cookie,
			domain: 'localhost',
			path: '/',
			httpOnly: true,
			sameSite: 'Lax'
		}
	]);
	return { userId, username };
}
