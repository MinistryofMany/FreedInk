// Integration: feature flags DB CRUD + override behavior + cache.
//
// We touch the real `db` from $lib/db/client and rely on tests/setup/db
// truncating between cases.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	createFlag,
	getFlag,
	listFlags,
	setFlag,
	setOverride,
	removeOverride,
	listOverridesForUser,
	isFlagEnabled,
	deleteFlag,
	_resetFlagCacheForTests
} from '$lib/server/flags';
import { db, schema } from '$lib/db/client';
import { eq, desc } from 'drizzle-orm';
import { createUserWithEmail } from '$lib/db/users';

beforeEach(() => {
	_resetFlagCacheForTests();
});

describe('flags: CRUD', () => {
	it('createFlag persists with defaults (disabled, 0% rollout)', async () => {
		const actor = await createUserWithEmail('actor@x.com', 'actor');
		const f = await createFlag('feature.demo', 'demo flag', actor.id);
		expect(f.key).toBe('feature.demo');
		expect(f.enabled).toBe(false);
		expect(f.rolloutPercentage).toBe(0);
		expect(f.description).toBe('demo flag');
		expect(f.updatedByUserId).toBe(actor.id);

		const loaded = await getFlag('feature.demo');
		expect(loaded?.key).toBe('feature.demo');
	});

	it('createFlag rejects invalid keys', async () => {
		await expect(createFlag('Bad Key', null, null)).rejects.toThrow();
	});

	it('listFlags returns alpha-sorted entries', async () => {
		await createFlag('zeta', null, null);
		await createFlag('alpha', null, null);
		await createFlag('mid.flag', null, null);
		const rows = await listFlags();
		expect(rows.map((r) => r.key)).toEqual(['alpha', 'mid.flag', 'zeta']);
	});

	it('setFlag updates enabled / rollout / description', async () => {
		await createFlag('feat.x', 'old', null);
		const after = await setFlag(
			'feat.x',
			{ enabled: true, rolloutPercentage: 42, description: 'new' },
			null
		);
		expect(after?.enabled).toBe(true);
		expect(after?.rolloutPercentage).toBe(42);
		expect(after?.description).toBe('new');
	});

	it('setFlag rejects out-of-range rollout', async () => {
		await createFlag('feat.bad', null, null);
		await expect(setFlag('feat.bad', { rolloutPercentage: 999 }, null)).rejects.toThrow();
		await expect(setFlag('feat.bad', { rolloutPercentage: -1 }, null)).rejects.toThrow();
	});

	it('deleteFlag removes the row and its overrides via FK cascade', async () => {
		const u = await createUserWithEmail('o@x.com', 'override-target');
		await createFlag('feat.gone', null, null);
		await setOverride('feat.gone', u.id, true, null);
		expect((await listOverridesForUser(u.id)).length).toBe(1);
		await deleteFlag('feat.gone', null);
		expect(await getFlag('feat.gone')).toBeNull();
		expect((await listOverridesForUser(u.id)).length).toBe(0);
	});
});

describe('flags: isFlagEnabled', () => {
	it('returns false for an unknown flag', async () => {
		expect(await isFlagEnabled('does.not.exist')).toBe(false);
	});

	it('returns false when the flag is disabled, even with rollout=100', async () => {
		const u = await createUserWithEmail('off@x.com', 'off-user');
		await createFlag('feat.off', null, null);
		await setFlag('feat.off', { enabled: false, rolloutPercentage: 100 }, null);
		expect(await isFlagEnabled('feat.off', u.id)).toBe(false);
	});

	it('returns true at rollout=100 once enabled', async () => {
		const u = await createUserWithEmail('on@x.com', 'on-user');
		await createFlag('feat.on', null, null);
		await setFlag('feat.on', { enabled: true, rolloutPercentage: 100 }, null);
		expect(await isFlagEnabled('feat.on', u.id)).toBe(true);
		expect(await isFlagEnabled('feat.on', null)).toBe(true);
	});

	it('per-user override beats the global enabled=false', async () => {
		const u = await createUserWithEmail('p@x.com', 'p');
		await createFlag('feat.maybe', null, null);
		await setFlag('feat.maybe', { enabled: false, rolloutPercentage: 0 }, null);
		await setOverride('feat.maybe', u.id, true, null);
		_resetFlagCacheForTests();
		expect(await isFlagEnabled('feat.maybe', u.id)).toBe(true);
	});

	it('per-user override beats rollout admit at the global level', async () => {
		const u = await createUserWithEmail('q@x.com', 'q');
		await createFlag('feat.deny', null, null);
		await setFlag('feat.deny', { enabled: true, rolloutPercentage: 100 }, null);
		await setOverride('feat.deny', u.id, false, null);
		_resetFlagCacheForTests();
		expect(await isFlagEnabled('feat.deny', u.id)).toBe(false);
	});
});

describe('flags: overrides CRUD', () => {
	it('setOverride upserts on conflict', async () => {
		const u = await createUserWithEmail('up@x.com', 'up');
		await createFlag('feat.up', null, null);
		await setOverride('feat.up', u.id, true, null);
		await setOverride('feat.up', u.id, false, null); // upsert
		const list = await listOverridesForUser(u.id);
		expect(list).toHaveLength(1);
		expect(list[0].enabled).toBe(false);
	});

	it('removeOverride deletes the row', async () => {
		const u = await createUserWithEmail('r@x.com', 'r');
		await createFlag('feat.rm', null, null);
		await setOverride('feat.rm', u.id, true, null);
		expect(await removeOverride('feat.rm', u.id, null)).toBe(true);
		expect(await removeOverride('feat.rm', u.id, null)).toBe(false);
		expect(await listOverridesForUser(u.id)).toHaveLength(0);
	});
});

describe('flags: audit trail', () => {
	it('writes feature_flag.changed on create + update + override', async () => {
		const actor = await createUserWithEmail('a@x.com', 'a');
		await createFlag('feat.audit', 'desc', actor.id);
		await setFlag('feat.audit', { enabled: true }, actor.id);
		const u = await createUserWithEmail('o@x.com', 'o');
		await setOverride('feat.audit', u.id, true, actor.id);

		const rows = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'feature_flag.changed'))
			.orderBy(desc(schema.auditLog.createdAt));

		const actions = rows.map((r) => (r.metadata as { action?: string } | null)?.action);
		expect(actions).toContain('create');
		expect(actions).toContain('update');
		expect(actions).toContain('override_set');
	});
});
