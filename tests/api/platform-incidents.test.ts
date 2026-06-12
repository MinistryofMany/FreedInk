// API tests for /api/platform/incidents and its [id]/update + [id]/resolve
// children. PLATFORM_OPERATORS is "platform-op" in .env.test so a user with
// that username is the operator; anyone else gets 403.
import { describe, it, expect, beforeEach } from 'vitest';
import { postJSON, asUser, BASE_URL } from './helpers';
import { db, schema } from '$lib/db/client';
import { eq, sql } from 'drizzle-orm';
import { makeUser } from '../setup/factories';
import { declareIncident } from '$lib/db/status';

async function truncateRateLimits(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE ${schema.rateLimits}`);
}

describe('POST /api/platform/incidents — declare', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('401 for unauthenticated', async () => {
		const res = await postJSON('/api/platform/incidents', {
			title: 'X',
			level: 'degraded'
		});
		expect(res.status).toBe(401);
	});

	it('403 for an authed non-operator', async () => {
		const u = await makeUser({ username: 'not-op-i1' });
		const { cookie } = await asUser(u);
		const res = await postJSON(
			'/api/platform/incidents',
			{ title: 'X', level: 'degraded' },
			{ cookie }
		);
		expect(res.status).toBe(403);
	});

	it('422 on bad body (missing title)', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON('/api/platform/incidents', { level: 'degraded' }, { cookie });
		expect(res.status).toBe(422);
	});

	it('422 on bad level enum value', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON(
			'/api/platform/incidents',
			{ title: 'X', level: 'on_fire' },
			{ cookie }
		);
		expect(res.status).toBe(422);
	});

	it('200 + DB row + audit on operator declare', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON(
			'/api/platform/incidents',
			{ title: 'Big bang', level: 'major_outage' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const { id } = await res.json();
		expect(typeof id).toBe('string');

		const [row] = await db
			.select()
			.from(schema.statusIncidents)
			.where(eq(schema.statusIncidents.id, id));
		expect(row.title).toBe('Big bang');
		expect(row.level).toBe('major_outage');
		expect(row.status).toBe('investigating');
		expect(row.declaredByUserId).toBe(op.id);

		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'incident.declared'));
		expect(audits.length).toBeGreaterThanOrEqual(1);
	});
});

describe('POST /api/platform/incidents/[id]/update', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	async function seedIncident() {
		const op = await makeUser({
			username: `seed-${Math.random().toString(36).slice(2, 8)}`
		});
		const inc = await declareIncident({
			title: 'seeded',
			level: 'degraded',
			declaredByUserId: op.id
		});
		return inc.id;
	}

	it('401 unauthenticated', async () => {
		const id = await seedIncident();
		const res = await postJSON(`/api/platform/incidents/${id}/update`, {
			status: 'monitoring',
			body: 'hi'
		});
		expect(res.status).toBe(401);
	});

	it('403 non-operator', async () => {
		const id = await seedIncident();
		const u = await makeUser({ username: 'not-op-u1' });
		const { cookie } = await asUser(u);
		const res = await postJSON(
			`/api/platform/incidents/${id}/update`,
			{ status: 'monitoring', body: 'hi' },
			{ cookie }
		);
		expect(res.status).toBe(403);
	});

	it('422 on missing body', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const id = await seedIncident();
		const res = await postJSON(
			`/api/platform/incidents/${id}/update`,
			{ status: 'monitoring' },
			{ cookie }
		);
		expect(res.status).toBe(422);
	});

	it('404 for unknown incident id', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON(
			`/api/platform/incidents/00000000-0000-0000-0000-000000000000/update`,
			{ status: 'monitoring', body: 'hi' },
			{ cookie }
		);
		expect(res.status).toBe(404);
	});

	it('404 for non-uuid id', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON(
			`/api/platform/incidents/not-a-uuid/update`,
			{ status: 'monitoring', body: 'hi' },
			{ cookie }
		);
		expect(res.status).toBe(404);
	});

	it('operator can post an update + DB row + audit', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const id = await seedIncident();

		const res = await postJSON(
			`/api/platform/incidents/${id}/update`,
			{ status: 'identified', body: 'cause: cache stampede' },
			{ cookie }
		);
		expect(res.status).toBe(200);

		const updates = await db
			.select()
			.from(schema.statusIncidentUpdates)
			.where(eq(schema.statusIncidentUpdates.incidentId, id));
		expect(updates).toHaveLength(1);
		expect(updates[0].status).toBe('identified');
		expect(updates[0].body).toContain('cache stampede');

		const [inc] = await db
			.select()
			.from(schema.statusIncidents)
			.where(eq(schema.statusIncidents.id, id));
		expect(inc.status).toBe('identified');

		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'incident.updated'));
		expect(audits.length).toBeGreaterThanOrEqual(1);
	});
});

describe('POST /api/platform/incidents/[id]/resolve', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	async function seedIncident() {
		const op = await makeUser({
			username: `seed-r-${Math.random().toString(36).slice(2, 8)}`
		});
		const inc = await declareIncident({
			title: 'to resolve',
			level: 'partial_outage',
			declaredByUserId: op.id
		});
		return inc.id;
	}

	it('401 unauthenticated', async () => {
		const id = await seedIncident();
		const res = await postJSON(`/api/platform/incidents/${id}/resolve`, {});
		expect(res.status).toBe(401);
	});

	it('403 non-operator', async () => {
		const id = await seedIncident();
		const u = await makeUser({ username: 'not-op-r1' });
		const { cookie } = await asUser(u);
		const res = await postJSON(`/api/platform/incidents/${id}/resolve`, {}, { cookie });
		expect(res.status).toBe(403);
	});

	it('404 for unknown id', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON(
			`/api/platform/incidents/00000000-0000-0000-0000-000000000000/resolve`,
			{},
			{ cookie }
		);
		expect(res.status).toBe(404);
	});

	it('operator resolve: status=resolved + resolved_at + final update + audit', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const id = await seedIncident();

		const res = await postJSON(
			`/api/platform/incidents/${id}/resolve`,
			{ body: 'fixed' },
			{ cookie }
		);
		expect(res.status).toBe(200);

		const [inc] = await db
			.select()
			.from(schema.statusIncidents)
			.where(eq(schema.statusIncidents.id, id));
		expect(inc.status).toBe('resolved');
		expect(inc.resolvedAt).toBeInstanceOf(Date);

		const updates = await db
			.select()
			.from(schema.statusIncidentUpdates)
			.where(eq(schema.statusIncidentUpdates.incidentId, id));
		expect(updates).toHaveLength(1);
		expect(updates[0].status).toBe('resolved');
		expect(updates[0].body).toBe('fixed');

		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'incident.resolved'));
		expect(audits.length).toBeGreaterThanOrEqual(1);
	});

	it('resolve with no body still inserts a default update', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const id = await seedIncident();
		const res = await postJSON(`/api/platform/incidents/${id}/resolve`, {}, { cookie });
		expect(res.status).toBe(200);
		const updates = await db
			.select()
			.from(schema.statusIncidentUpdates)
			.where(eq(schema.statusIncidentUpdates.incidentId, id));
		expect(updates).toHaveLength(1);
		expect(updates[0].body.length).toBeGreaterThan(0);
	});
});

describe('/admin/platform/incidents listing page', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('redirects non-operators away', async () => {
		const u = await makeUser({ username: 'inc-regular' });
		const { cookie } = await asUser(u);
		const res = await fetch(`${BASE_URL}/admin/platform/incidents`, {
			headers: { cookie },
			redirect: 'manual'
		});
		await res.text();
		expect(res.status).toBe(303);
	});

	it('renders for an operator', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		await declareIncident({
			title: 'Visible incident',
			level: 'degraded',
			declaredByUserId: op.id
		});
		const res = await fetch(`${BASE_URL}/admin/platform/incidents`, {
			headers: { cookie }
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html.toLowerCase()).toContain('status incidents');
		expect(html).toContain('Visible incident');
	});
});
