import { db, schema } from '$lib/db/client';
import { and, eq, ne, sql, lt } from 'drizzle-orm';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import type { User } from '$lib/db/schema';

function secret(): string {
	const s = env.SESSION_SECRET;
	if (!s) throw new Error('SESSION_SECRET is required');
	return s;
}

const COOKIE = 'sid';
const TTL_DAYS = 30;

export function sign(value: string): string {
	return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function packCookie(sessionId: string): string {
	return `${sessionId}.${sign(sessionId)}`;
}

export function unpackCookie(raw: string): string | null {
	const idx = raw.lastIndexOf('.');
	if (idx === -1) return null;
	const id = raw.slice(0, idx);
	const sig = raw.slice(idx + 1);
	const expected = sign(id);
	if (
		sig.length !== expected.length ||
		!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
	) {
		return null;
	}
	return id;
}

export class SuspendedUserError extends Error {
	constructor() {
		super('account suspended');
		this.name = 'SuspendedUserError';
	}
}

export async function createSession(
	userId: string,
	meta: { userAgent?: string | null; ip?: string | null }
): Promise<string> {
	// Refuse to issue a session for a suspended account. Callers see a thrown
	// SuspendedUserError that the API handlers translate to 403; the user
	// stays signed out.
	const [u] = await db
		.select({ suspendedAt: schema.users.suspendedAt })
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1);
	if (u?.suspendedAt) throw new SuspendedUserError();

	const expires = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
	const [row] = await db
		.insert(schema.sessions)
		.values({
			userId,
			expiresAt: expires,
			userAgent: meta.userAgent ?? null,
			ip: meta.ip ?? null
		})
		.returning({ id: schema.sessions.id });
	return row.id;
}

export async function loadSessionUser(rawCookie: string | undefined): Promise<User | null> {
	if (!rawCookie) return null;
	const id = unpackCookie(rawCookie);
	if (!id) return null;
	const rows = await db
		.select({ session: schema.sessions, user: schema.users })
		.from(schema.sessions)
		.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
		.where(eq(schema.sessions.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	if (row.session.expiresAt.getTime() < Date.now()) {
		await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
		return null;
	}
	// Suspended users can hold an unexpired session row but their requests are
	// rejected as if they were signed out. We also reap their sessions here so
	// they fall back to the public guest experience on the next click.
	if (row.user.suspendedAt) {
		await db.delete(schema.sessions).where(eq(schema.sessions.userId, row.user.id));
		return null;
	}
	await db
		.update(schema.sessions)
		.set({ lastSeenAt: sql`now()` })
		.where(eq(schema.sessions.id, id));
	return row.user;
}

export async function destroySession(rawCookie: string | undefined): Promise<void> {
	if (!rawCookie) return;
	const id = unpackCookie(rawCookie);
	if (!id) return;
	await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}

// Revoke every session for a user, optionally preserving one (typically the
// one we just minted as part of the same flow). Used by account recovery and
// identity rotation to invalidate other devices that might still hold a
// session for an account whose credential surface just changed.
export async function revokeAllSessions(
	userId: string,
	exceptSessionId?: string
): Promise<number> {
	const where = exceptSessionId
		? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, exceptSessionId))
		: eq(schema.sessions.userId, userId);
	const deleted = await db.delete(schema.sessions).where(where).returning({ id: schema.sessions.id });
	return deleted.length;
}

export async function destroySessionById(sessionId: string): Promise<void> {
	await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

export function setSessionCookie(cookies: Cookies, sessionId: string): void {
	cookies.set(COOKIE, packCookie(sessionId), {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: TTL_DAYS * 24 * 60 * 60
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(COOKIE, { path: '/' });
}

export const SESSION_COOKIE_NAME = COOKIE;

// Pull the session id out of the raw cookie value (after HMAC verification).
// Returns null for missing/invalid cookies. Convenience wrapper around
// unpackCookie that handlers can use to identify the caller's own session
// without re-reading the cookie value.
export function currentSessionId(rawCookie: string | undefined): string | null {
	if (!rawCookie) return null;
	return unpackCookie(rawCookie);
}

// Best-effort: drop expired sessions. Caller can ignore failures.
export async function reapExpiredSessions(): Promise<void> {
	await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}

// Random URL-safe token; used for email-verification and password-reset payloads.
export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}
