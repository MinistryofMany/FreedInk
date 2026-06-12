// API tests for /api/platform/reports/[id]/resolve + /dismiss.
// PLATFORM_OPERATORS is set to "platform-op" in .env.test, so a user
// with that username is the operator; anyone else gets 403.
import { describe, it, expect, beforeEach } from 'vitest';
import { postJSON, asUser, BASE_URL } from './helpers';
import { db, schema } from '$lib/db/client';
import { eq, sql } from 'drizzle-orm';
import { makeUser, makeBlogWith } from '../setup/factories';
import { createPost } from '$lib/db/posts';
import { createReport } from '$lib/db/reports';

async function truncateRateLimits(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE ${schema.rateLimits}`);
}

async function seedReport() {
	const owner = await makeUser({ username: `o-${Math.random().toString(36).slice(2, 8)}` });
	const { id: blogId } = await makeBlogWith({ owner });
	const r = await createPost({
		blogId,
		title: 'T',
		content: 'C',
		proof: {},
		snapshotRoot: 'r',
		nullifier: `n-${Math.random().toString(36).slice(2, 8)}`,
		status: 'under_review'
	});
	const report = await createReport({
		reporterIp: '127.0.0.1',
		targetType: 'post',
		targetId: r.post.id,
		reason: 'spam'
	});
	return { reportId: report.id };
}

describe('platform reports: auth gate', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('401 for unauthenticated resolve', async () => {
		const { reportId } = await seedReport();
		const res = await postJSON(`/api/platform/reports/${reportId}/resolve`, {});
		expect(res.status).toBe(401);
	});

	it('403 for an authed non-operator', async () => {
		const { reportId } = await seedReport();
		const u = await makeUser({ username: 'not-op' });
		const { cookie } = await asUser(u);
		const res = await postJSON(`/api/platform/reports/${reportId}/resolve`, {}, { cookie });
		expect(res.status).toBe(403);
	});

	it('401 for unauthenticated dismiss', async () => {
		const { reportId } = await seedReport();
		const res = await postJSON(`/api/platform/reports/${reportId}/dismiss`, {});
		expect(res.status).toBe(401);
	});

	it('403 for an authed non-operator (dismiss)', async () => {
		const { reportId } = await seedReport();
		const u = await makeUser({ username: 'not-op-2' });
		const { cookie } = await asUser(u);
		const res = await postJSON(`/api/platform/reports/${reportId}/dismiss`, {}, { cookie });
		expect(res.status).toBe(403);
	});
});

describe('platform reports: resolve', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('operator can resolve an open report; status + resolver + notes set', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const { reportId } = await seedReport();

		const res = await postJSON(
			`/api/platform/reports/${reportId}/resolve`,
			{ notes: 'cleaned' },
			{ cookie }
		);
		expect(res.status).toBe(200);

		const [row] = await db
			.select()
			.from(schema.abuseReports)
			.where(eq(schema.abuseReports.id, reportId));
		expect(row.status).toBe('resolved');
		expect(row.resolvedByUserId).toBe(op.id);
		expect(row.resolutionNotes).toBe('cleaned');
		expect(row.resolvedAt).toBeInstanceOf(Date);

		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'abuse.resolved'));
		expect(audits.length).toBe(1);
	});

	it('returns 404 for an unknown report id (valid uuid)', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON(
			`/api/platform/reports/00000000-0000-0000-0000-000000000000/resolve`,
			{},
			{ cookie }
		);
		expect(res.status).toBe(404);
	});

	it('returns 404 for a non-uuid id', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await postJSON(`/api/platform/reports/not-a-uuid/resolve`, {}, { cookie });
		expect(res.status).toBe(404);
	});
});

describe('platform reports: dismiss', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('operator can dismiss an open report; audit fires as abuse.dismissed', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const { reportId } = await seedReport();

		const res = await postJSON(
			`/api/platform/reports/${reportId}/dismiss`,
			{ notes: 'not actionable' },
			{ cookie }
		);
		expect(res.status).toBe(200);

		const [row] = await db
			.select()
			.from(schema.abuseReports)
			.where(eq(schema.abuseReports.id, reportId));
		expect(row.status).toBe('dismissed');
		expect(row.resolutionNotes).toBe('not actionable');

		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'abuse.dismissed'));
		expect(audits.length).toBe(1);
	});
});

describe('platform reports: /admin/platform/reports page', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('redirects non-operators away', async () => {
		const u = await makeUser({ username: 'regular-user' });
		const { cookie } = await asUser(u);
		const res = await fetch(`${BASE_URL}/admin/platform/reports`, {
			headers: { cookie },
			redirect: 'manual'
		});
		await res.text();
		expect(res.status).toBe(303);
	});

	it('renders for an operator and shows the report row', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		await seedReport();
		const res = await fetch(`${BASE_URL}/admin/platform/reports`, {
			headers: { cookie }
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html.toLowerCase()).toContain('abuse reports');
		expect(html).toContain('spam');
	});
});
