// DB-backed fixed-window rate limiter. Why a DB table and not in-memory?
//   • Survives process restarts (matters for SIWE nonce flood protection).
//   • Works across replicas without a shared cache.
//   • Cleanup job reaps expired window rows; cardinality stays bounded.
// Fixed-window is coarser than token bucket but simpler and good enough for
// "stop the floods" protection. If a single bursty user becomes a problem we
// can swap in a leaky bucket later — interface stays the same.
import { db, schema } from '$lib/db/client';
import { sql } from 'drizzle-orm';
import { error, type RequestEvent } from '@sveltejs/kit';
import { log } from './log';

export type RateLimitRule = {
	// e.g. 'login:start', 'comment:post', 'api:nonce'.
	bucket: string;
	// Max events per windowSeconds.
	max: number;
	windowSeconds: number;
};

function windowStartFor(now: Date, windowSeconds: number): Date {
	const ms = windowSeconds * 1000;
	return new Date(Math.floor(now.getTime() / ms) * ms);
}

// Build a key from the bucket + a discriminator. For unauth flows pass the
// client IP; for auth flows pass the user id.
export function buildKey(bucket: string, discriminator: string): string {
	return `${bucket}:${discriminator}`;
}

// Increment the counter for the current window; return whether the request is
// allowed. Implemented via INSERT ... ON CONFLICT to atomically bump count
// without a read+write race.
export async function consume(
	rule: RateLimitRule,
	key: string
): Promise<{
	allowed: boolean;
	remaining: number;
	resetAt: Date;
}> {
	const now = new Date();
	const windowStart = windowStartFor(now, rule.windowSeconds);
	const expiresAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);

	const result = await db
		.insert(schema.rateLimits)
		.values({ key, windowStart, count: 1, expiresAt })
		.onConflictDoUpdate({
			target: [schema.rateLimits.key, schema.rateLimits.windowStart],
			set: { count: sql`${schema.rateLimits.count} + 1` }
		})
		.returning({ count: schema.rateLimits.count });

	const count = result[0]?.count ?? 1;
	const remaining = Math.max(0, rule.max - count);
	return { allowed: count <= rule.max, remaining, resetAt: expiresAt };
}

// Enforce a rate limit for a request. Throws SvelteKit error(429) on breach
// with Retry-After header information in the body (the actual header is set
// in the hook for the global response).
export async function enforce(
	rule: RateLimitRule,
	event: RequestEvent,
	options: { keyBy?: 'ip' | 'user' | 'both' } = {}
): Promise<void> {
	const discriminator =
		options.keyBy === 'user'
			? (event.locals.user?.id ?? event.getClientAddress())
			: options.keyBy === 'both'
				? `${event.locals.user?.id ?? 'anon'}@${event.getClientAddress()}`
				: event.getClientAddress();

	const key = buildKey(rule.bucket, discriminator);
	const decision = await consume(rule, key);

	if (!decision.allowed) {
		log.warn(
			{
				rule: rule.bucket,
				key,
				resetAt: decision.resetAt.toISOString()
			},
			'rate limit exceeded'
		);
		const retryAfter = Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000));
		throw error(429, `Too many requests. Try again in ${retryAfter}s.`);
	}
}

// Common buckets used across the app. Other modules can declare their own
// but centralizing the most common keeps tuning in one place.
export const RULES = {
	// Anon endpoints — keyed by IP. authStart/authFinish guard the two halves
	// of the Minister "Sign in with Minister" OIDC round-trip.
	authStart: { bucket: 'auth:start', max: 10, windowSeconds: 60 } satisfies RateLimitRule,
	authFinish: { bucket: 'auth:finish', max: 20, windowSeconds: 60 } satisfies RateLimitRule,
	// Authed endpoints — keyed by user.
	postCreate: { bucket: 'post:create', max: 30, windowSeconds: 60 * 60 } satisfies RateLimitRule,
	reviewCast: { bucket: 'review:cast', max: 60, windowSeconds: 60 * 60 } satisfies RateLimitRule,
	commentPost: { bucket: 'comment:post', max: 30, windowSeconds: 5 * 60 } satisfies RateLimitRule,
	identityRotate: {
		bucket: 'identity:rotate',
		max: 3,
		windowSeconds: 60 * 60
	} satisfies RateLimitRule,
	inviteSend: { bucket: 'invite:send', max: 20, windowSeconds: 60 * 60 } satisfies RateLimitRule
} as const;
