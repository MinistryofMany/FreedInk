// End-to-end exercise of the incident helpers in $lib/db/status: declare,
// post updates, resolve. Asserts state transitions, timeline ordering, and
// that the latest-update join used by the public page reflects the most
// recent body.
import { describe, it, expect } from 'vitest';
import { makeUser } from '../setup/factories';
import {
	declareIncident,
	postIncidentUpdate,
	resolveIncident,
	getIncidentWithUpdates,
	listActiveIncidents,
	listRecentResolvedIncidents,
	listIncidentsForOperator,
	worstLevel,
	recentWorstLevel,
	dailyUptime,
	recordStatusCheck
} from '$lib/db/status';

async function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

describe('status incidents: declare → update → resolve', () => {
	it('declares an incident with status=investigating', async () => {
		const op = await makeUser({ username: 'inc-op-1' });
		const inc = await declareIncident({
			title: 'API hiccup',
			level: 'partial_outage',
			declaredByUserId: op.id
		});
		expect(inc.title).toBe('API hiccup');
		expect(inc.level).toBe('partial_outage');
		expect(inc.status).toBe('investigating');
		expect(inc.resolvedAt).toBeNull();
	});

	it('appends updates and bumps the incident status', async () => {
		const op = await makeUser({ username: 'inc-op-2' });
		const inc = await declareIncident({
			title: 'DB slow',
			level: 'degraded',
			declaredByUserId: op.id
		});

		const r1 = await postIncidentUpdate({
			incidentId: inc.id,
			status: 'identified',
			body: 'It was the index',
			postedByUserId: op.id
		});
		expect(r1?.incident.status).toBe('identified');
		expect(r1?.update.body).toBe('It was the index');

		// Brief gap so ordering by createdAt is deterministic on fast hosts.
		await sleep(5);

		const r2 = await postIncidentUpdate({
			incidentId: inc.id,
			status: 'monitoring',
			body: 'Watching it',
			postedByUserId: op.id
		});
		expect(r2?.incident.status).toBe('monitoring');

		const full = await getIncidentWithUpdates(inc.id);
		expect(full).not.toBeNull();
		expect(full!.updates).toHaveLength(2);
		// Timeline is oldest-first.
		expect(full!.updates[0].body).toBe('It was the index');
		expect(full!.updates[1].body).toBe('Watching it');
		// The two timestamps must be monotonic.
		expect(full!.updates[0].createdAt.getTime()).toBeLessThanOrEqual(
			full!.updates[1].createdAt.getTime()
		);
	});

	it('resolveIncident sets status=resolved, resolved_at, and appends a final update', async () => {
		const op = await makeUser({ username: 'inc-op-3' });
		const inc = await declareIncident({
			title: 'Outage',
			level: 'major_outage',
			declaredByUserId: op.id
		});

		const res = await resolveIncident({
			incidentId: inc.id,
			postedByUserId: op.id,
			body: 'Power restored'
		});
		expect(res?.incident.status).toBe('resolved');
		expect(res?.incident.resolvedAt).toBeInstanceOf(Date);

		const full = await getIncidentWithUpdates(inc.id);
		expect(full!.updates).toHaveLength(1);
		expect(full!.updates[0].status).toBe('resolved');
		expect(full!.updates[0].body).toBe('Power restored');
	});

	it('resolveIncident with no body emits a default note', async () => {
		const op = await makeUser({ username: 'inc-op-4' });
		const inc = await declareIncident({
			title: 'Minor blip',
			level: 'degraded',
			declaredByUserId: op.id
		});
		const res = await resolveIncident({
			incidentId: inc.id,
			postedByUserId: op.id,
			body: null
		});
		expect(res?.update.body.length).toBeGreaterThan(0);
	});

	it('returns null for unknown incident ids', async () => {
		const op = await makeUser({ username: 'inc-op-5' });
		const missing = await postIncidentUpdate({
			incidentId: '00000000-0000-0000-0000-000000000000',
			status: 'monitoring',
			body: 'noop',
			postedByUserId: op.id
		});
		expect(missing).toBeNull();
		const missingRes = await resolveIncident({
			incidentId: '00000000-0000-0000-0000-000000000000',
			postedByUserId: op.id,
			body: 'noop'
		});
		expect(missingRes).toBeNull();
	});
});

describe('status incidents: list helpers', () => {
	it('active list excludes resolved, recent-resolved includes them', async () => {
		const op = await makeUser({ username: 'inc-op-list' });

		const active = await declareIncident({
			title: 'Active 1',
			level: 'degraded',
			declaredByUserId: op.id
		});
		const willResolve = await declareIncident({
			title: 'To resolve',
			level: 'partial_outage',
			declaredByUserId: op.id
		});
		await postIncidentUpdate({
			incidentId: active.id,
			status: 'monitoring',
			body: 'still watching',
			postedByUserId: op.id
		});
		await resolveIncident({
			incidentId: willResolve.id,
			postedByUserId: op.id,
			body: 'done'
		});

		const activeList = await listActiveIncidents();
		expect(activeList.map((i) => i.id)).toContain(active.id);
		expect(activeList.map((i) => i.id)).not.toContain(willResolve.id);
		// The latest update body should be hydrated.
		const found = activeList.find((i) => i.id === active.id);
		expect(found?.latestUpdateBody).toBe('still watching');

		const resolvedList = await listRecentResolvedIncidents(30);
		expect(resolvedList.map((i) => i.id)).toContain(willResolve.id);

		const opAll = await listIncidentsForOperator('all');
		expect(opAll.map((i) => i.id)).toEqual(expect.arrayContaining([active.id, willResolve.id]));
		const opActive = await listIncidentsForOperator('active');
		expect(opActive.map((i) => i.id)).toContain(active.id);
		expect(opActive.map((i) => i.id)).not.toContain(willResolve.id);
	});
});

describe('status reads: probe rollups', () => {
	it('worstLevel collapses an iterable to its worst entry', () => {
		expect(worstLevel(['operational', 'degraded'])).toBe('degraded');
		expect(worstLevel(['degraded', 'major_outage', 'operational'])).toBe('major_outage');
		expect(worstLevel([])).toBe('operational');
	});

	it('recentWorstLevel reflects the worst probe in the window', async () => {
		await recordStatusCheck({ component: 'app', level: 'operational', latencyMs: 10 });
		await recordStatusCheck({ component: 'app', level: 'degraded', latencyMs: 800 });
		expect(await recentWorstLevel(10)).toBe('degraded');
	});

	it('dailyUptime returns one entry per day for the requested window', async () => {
		const days = await dailyUptime(7);
		expect(days).toHaveLength(7);
		// Every entry has either a level or null.
		for (const d of days) {
			expect(typeof d.date).toBe('string');
			expect(d.level === null || typeof d.level === 'string').toBe(true);
		}
	});
});
