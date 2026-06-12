// Feature-flag library. Three concentric concepts:
//   1. The flag row itself: enabled + rollout_percentage.
//   2. A per-user override row (PK flag_key, user_id) that wins outright.
//   3. The rollout decision when 0 < rolloutPercentage < 100: a stable
//      hash of `(userId || ip || 'anon') + key` mapped to [0, 100), and
//      we admit the user when the bucket < rolloutPercentage. Same input
//      always lands in the same bucket, so a user doesn't "flap" across
//      page loads.
//
// Cache: a 5-second in-process memo on read paths so we don't slam the DB
// per request. Writes from THIS process bust the cache immediately; other
// processes will see updated state within 5s. That latency is fine for the
// platform-operator workflow (flags don't change every minute).
//
// Future shape for client-side reads (not implemented here): a tiny load
// helper would call `evaluateFlagsForUser(userId, ip, keys[])` on the
// server, return `{ [key]: boolean }`, and the +layout.server.ts pages
// would expose that under `data.flags`. A Svelte store can hydrate from
// `$page.data.flags` and components can read `$flags.someKey`.
import { db, schema } from '$lib/db/client';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { audit } from './audit';
import { log } from './log';

export type FlagRow = {
	key: string;
	description: string | null;
	enabled: boolean;
	rolloutPercentage: number;
	updatedAt: Date;
	updatedByUserId: string | null;
};

export type OverrideRow = {
	flagKey: string;
	userId: string;
	enabled: boolean;
	createdAt: Date;
};

// ──────────────────────────── slug pattern ────────────────────────────
//
// Flag keys are dot-or-dash separated lowercase slugs. We enforce this at
// create time so operators don't create keys like "My Flag!" that look
// fine but break URLs and code references later.
const KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,63}$/;

export function isValidFlagKey(key: string): boolean {
	return KEY_PATTERN.test(key);
}

// ──────────────────────────── cache ────────────────────────────

const CACHE_TTL_MS = 5_000;

type CachedFlag = { row: FlagRow | null; expiresAt: number };
const flagCache = new Map<string, CachedFlag>();

type CachedOverride = { row: OverrideRow | null; expiresAt: number };
const overrideCache = new Map<string, CachedOverride>();

let listCache: { rows: FlagRow[]; expiresAt: number } | null = null;

function nowMs(): number {
	return Date.now();
}

function invalidateFlagCache(key?: string): void {
	if (key) {
		flagCache.delete(key);
	} else {
		flagCache.clear();
	}
	listCache = null;
}

function invalidateOverrideCache(flagKey: string, userId: string): void {
	overrideCache.delete(`${flagKey}:${userId}`);
}

// Test-only helper for resetting cache state between assertions.
export function _resetFlagCacheForTests(): void {
	flagCache.clear();
	overrideCache.clear();
	listCache = null;
}

// ──────────────────────────── reads ────────────────────────────

async function loadFlag(key: string): Promise<FlagRow | null> {
	const cached = flagCache.get(key);
	const t = nowMs();
	if (cached && cached.expiresAt > t) return cached.row;
	const rows = await db
		.select()
		.from(schema.featureFlags)
		.where(eq(schema.featureFlags.key, key))
		.limit(1);
	const row = (rows[0] ?? null) as FlagRow | null;
	flagCache.set(key, { row, expiresAt: t + CACHE_TTL_MS });
	return row;
}

async function loadOverride(
	flagKey: string,
	userId: string
): Promise<OverrideRow | null> {
	const cacheKey = `${flagKey}:${userId}`;
	const cached = overrideCache.get(cacheKey);
	const t = nowMs();
	if (cached && cached.expiresAt > t) return cached.row;
	const rows = await db
		.select()
		.from(schema.featureFlagOverrides)
		.where(
			and(
				eq(schema.featureFlagOverrides.flagKey, flagKey),
				eq(schema.featureFlagOverrides.userId, userId)
			)
		)
		.limit(1);
	const row = (rows[0] ?? null) as OverrideRow | null;
	overrideCache.set(cacheKey, { row, expiresAt: t + CACHE_TTL_MS });
	return row;
}

export async function listFlags(): Promise<FlagRow[]> {
	const t = nowMs();
	if (listCache && listCache.expiresAt > t) return listCache.rows;
	const rows = (await db.select().from(schema.featureFlags)) as FlagRow[];
	rows.sort((a, b) => a.key.localeCompare(b.key));
	listCache = { rows, expiresAt: t + CACHE_TTL_MS };
	return rows;
}

export async function getFlag(key: string): Promise<FlagRow | null> {
	return loadFlag(key);
}

export async function listOverridesForUser(userId: string): Promise<OverrideRow[]> {
	const rows = await db
		.select()
		.from(schema.featureFlagOverrides)
		.where(eq(schema.featureFlagOverrides.userId, userId));
	return rows as OverrideRow[];
}

export async function listOverridesForFlag(flagKey: string): Promise<OverrideRow[]> {
	const rows = await db
		.select()
		.from(schema.featureFlagOverrides)
		.where(eq(schema.featureFlagOverrides.flagKey, flagKey));
	return rows as OverrideRow[];
}

// ──────────────────────────── rollout math ────────────────────────────

// Stable bucket in [0, 100) for (discriminator, key). We use SHA-256
// because it's already imported elsewhere, then take the first 4 bytes as
// a uint32 and modulo 100. Modulo bias on a 32-bit range vs. 100 is
// negligible (<< 1 / 2^25), so the distribution is effectively uniform.
export function rolloutBucket(discriminator: string, key: string): number {
	const h = createHash('sha256')
		.update(discriminator)
		.update('|')
		.update(key)
		.digest();
	const n = h.readUInt32BE(0);
	return n % 100;
}

// Apply the rollout-percentage decision. 0 => never, 100 => always.
function isInRollout(
	discriminator: string,
	key: string,
	rolloutPercentage: number
): boolean {
	if (rolloutPercentage <= 0) return false;
	if (rolloutPercentage >= 100) return true;
	return rolloutBucket(discriminator, key) < rolloutPercentage;
}

// ──────────────────────────── main evaluator ────────────────────────────

export type FlagContext = {
	userId?: string | null;
	ip?: string | null;
};

export async function isFlagEnabled(
	key: string,
	userIdOrCtx?: string | null | FlagContext
): Promise<boolean> {
	const ctx: FlagContext =
		userIdOrCtx == null || typeof userIdOrCtx === 'string'
			? { userId: userIdOrCtx ?? null }
			: userIdOrCtx;

	const flag = await loadFlag(key);
	// Missing flag is treated as off. Callers should `createFlag` first if
	// they want to ramp it; reading a missing key shouldn't throw because
	// that would tie deployments to operator-side timing.
	if (!flag) return false;

	if (ctx.userId) {
		const override = await loadOverride(key, ctx.userId);
		if (override) return override.enabled;
	}

	if (!flag.enabled) return false;

	const discriminator = ctx.userId ?? ctx.ip ?? 'anon';
	return isInRollout(discriminator, key, flag.rolloutPercentage);
}

// Batch helper: evaluate many flags for the same context in one shot.
// Useful for the (future) layout serializer.
export async function evaluateFlagsForUser(
	keys: string[],
	ctx: FlagContext
): Promise<Record<string, boolean>> {
	const out: Record<string, boolean> = {};
	await Promise.all(
		keys.map(async (k) => {
			out[k] = await isFlagEnabled(k, ctx);
		})
	);
	return out;
}

// ──────────────────────────── writes ────────────────────────────

export async function createFlag(
	key: string,
	description: string | null,
	actorUserId: string | null
): Promise<FlagRow> {
	if (!isValidFlagKey(key)) {
		throw new Error(`invalid flag key: ${key}`);
	}
	const [row] = (await db
		.insert(schema.featureFlags)
		.values({
			key,
			description,
			enabled: false,
			rolloutPercentage: 0,
			updatedByUserId: actorUserId
		})
		.returning()) as FlagRow[];
	invalidateFlagCache(key);
	// Audit on creation is part of "feature_flag.changed" (action=create).
	await audit(null, {
		event: 'feature_flag.changed',
		actorUserId,
		metadata: { key, action: 'create', description }
	}).catch((err: unknown) => log.error({ err }, 'flag-create audit failed'));
	return row;
}

export type FlagPatch = {
	enabled?: boolean;
	rolloutPercentage?: number;
	description?: string | null;
};

// Clamp rollout to [0, 100]. Operators shouldn't be sending out-of-range
// values from the UI (the slider caps it), but a raw API caller might —
// fail loudly rather than silently truncating to a confusing value.
function validatePatch(patch: FlagPatch): void {
	if (patch.rolloutPercentage !== undefined) {
		if (
			!Number.isFinite(patch.rolloutPercentage) ||
			patch.rolloutPercentage < 0 ||
			patch.rolloutPercentage > 100
		) {
			throw new Error('rollout_percentage must be between 0 and 100');
		}
	}
}

export async function setFlag(
	key: string,
	patch: FlagPatch,
	actorUserId: string | null
): Promise<FlagRow | null> {
	validatePatch(patch);
	const update: Record<string, unknown> = { updatedAt: new Date() };
	if (patch.enabled !== undefined) update.enabled = patch.enabled;
	if (patch.rolloutPercentage !== undefined)
		update.rolloutPercentage = Math.floor(patch.rolloutPercentage);
	if (patch.description !== undefined) update.description = patch.description;
	if (actorUserId !== undefined) update.updatedByUserId = actorUserId;

	const rows = (await db
		.update(schema.featureFlags)
		.set(update)
		.where(eq(schema.featureFlags.key, key))
		.returning()) as FlagRow[];
	const row = rows[0] ?? null;
	invalidateFlagCache(key);
	if (row) {
		await audit(null, {
			event: 'feature_flag.changed',
			actorUserId,
			metadata: {
				key,
				action: 'update',
				patch: {
					enabled: patch.enabled,
					rollout_percentage: patch.rolloutPercentage,
					description: patch.description
				}
			}
		}).catch((err: unknown) => log.error({ err }, 'flag-update audit failed'));
	}
	return row;
}

export async function setOverride(
	flagKey: string,
	userId: string,
	enabled: boolean,
	actorUserId: string | null
): Promise<OverrideRow> {
	const [row] = (await db
		.insert(schema.featureFlagOverrides)
		.values({ flagKey, userId, enabled })
		.onConflictDoUpdate({
			target: [
				schema.featureFlagOverrides.flagKey,
				schema.featureFlagOverrides.userId
			],
			set: { enabled }
		})
		.returning()) as OverrideRow[];
	invalidateOverrideCache(flagKey, userId);
	await audit(null, {
		event: 'feature_flag.changed',
		actorUserId,
		subjectUserId: userId,
		metadata: { key: flagKey, action: 'override_set', enabled }
	}).catch((err: unknown) => log.error({ err }, 'override-set audit failed'));
	return row;
}

export async function removeOverride(
	flagKey: string,
	userId: string,
	actorUserId: string | null
): Promise<boolean> {
	const deleted = await db
		.delete(schema.featureFlagOverrides)
		.where(
			and(
				eq(schema.featureFlagOverrides.flagKey, flagKey),
				eq(schema.featureFlagOverrides.userId, userId)
			)
		)
		.returning({ flagKey: schema.featureFlagOverrides.flagKey });
	invalidateOverrideCache(flagKey, userId);
	if (deleted.length > 0) {
		await audit(null, {
			event: 'feature_flag.changed',
			actorUserId,
			subjectUserId: userId,
			metadata: { key: flagKey, action: 'override_remove' }
		}).catch((err: unknown) => log.error({ err }, 'override-remove audit failed'));
	}
	return deleted.length > 0;
}

export async function deleteFlag(
	key: string,
	actorUserId: string | null
): Promise<boolean> {
	const deleted = await db
		.delete(schema.featureFlags)
		.where(eq(schema.featureFlags.key, key))
		.returning({ key: schema.featureFlags.key });
	invalidateFlagCache(key);
	if (deleted.length > 0) {
		await audit(null, {
			event: 'feature_flag.changed',
			actorUserId,
			metadata: { key, action: 'delete' }
		}).catch((err: unknown) => log.error({ err }, 'flag-delete audit failed'));
	}
	return deleted.length > 0;
}
