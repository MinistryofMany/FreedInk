// API tests for POST /api/report — validation, target-exists check, rate
// limits, and the authed/anon shapes.
import { describe, it, expect, beforeEach } from 'vitest';
import { postJSON, asUser } from './helpers';
import { db, schema } from '$lib/db/client';
import { sql, eq, desc } from 'drizzle-orm';
import { makeUser, makeBlogWith } from '../setup/factories';
import { createPost } from '$lib/db/posts';

async function truncateRateLimits(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE ${schema.rateLimits}`);
}

async function seedPost() {
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
	return { blogId, postId: r.post.id };
}

describe('POST /api/report: validation', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('returns 422 on missing fields', async () => {
		const res = await postJSON('/api/report', {});
		expect(res.status).toBe(422);
	});

	it('returns 422 on a bogus reason', async () => {
		const { postId } = await seedPost();
		const res = await postJSON('/api/report', {
			target_type: 'post',
			target_id: postId,
			reason: 'not-a-real-reason'
		});
		expect(res.status).toBe(422);
	});

	it('returns 422 on a bogus target_type', async () => {
		const { postId } = await seedPost();
		const res = await postJSON('/api/report', {
			target_type: 'banana',
			target_id: postId,
			reason: 'spam'
		});
		expect(res.status).toBe(422);
	});

	it('returns 422 on a non-uuid target_id', async () => {
		const res = await postJSON('/api/report', {
			target_type: 'post',
			target_id: 'not-a-uuid',
			reason: 'spam'
		});
		expect(res.status).toBe(422);
	});
});

describe('POST /api/report: target exists', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('returns 404 when target_id does not exist', async () => {
		const res = await postJSON('/api/report', {
			target_type: 'post',
			target_id: '00000000-0000-0000-0000-000000000000',
			reason: 'spam'
		});
		expect(res.status).toBe(404);
	});

	it('returns 200 when target_id exists; creates an open report', async () => {
		const { postId } = await seedPost();
		const res = await postJSON('/api/report', {
			target_type: 'post',
			target_id: postId,
			reason: 'spam',
			details: 'an ad'
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; report_id: string };
		expect(body.ok).toBe(true);

		const [row] = await db
			.select()
			.from(schema.abuseReports)
			.where(eq(schema.abuseReports.id, body.report_id));
		expect(row.targetType).toBe('post');
		expect(row.targetId).toBe(postId);
		expect(row.status).toBe('open');
		expect(row.reporterUserId).toBeNull();
		// Anon → ip captured
		expect(row.reporterIp).toBeTruthy();
	});
});

describe('POST /api/report: authed vs anon', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('authed report sets reporter_user_id and leaves reporter_ip null', async () => {
		const reporter = await makeUser({ username: 'authrep' });
		const { cookie } = await asUser(reporter);
		const { postId } = await seedPost();

		const res = await postJSON(
			'/api/report',
			{ target_type: 'post', target_id: postId, reason: 'harassment' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; report_id: string };

		const [row] = await db
			.select()
			.from(schema.abuseReports)
			.where(eq(schema.abuseReports.id, body.report_id));
		expect(row.reporterUserId).toBe(reporter.id);
		expect(row.reporterIp).toBeNull();
	});

	it('audits abuse.reported with the right metadata', async () => {
		const { postId } = await seedPost();
		const res = await postJSON('/api/report', {
			target_type: 'post',
			target_id: postId,
			reason: 'spam'
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; report_id: string };

		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'abuse.reported'))
			.orderBy(desc(schema.auditLog.createdAt))
			.limit(1);
		expect(audits[0]).toBeDefined();
		const meta = audits[0].metadata as Record<string, unknown>;
		expect(meta.report_id).toBe(body.report_id);
		expect(meta.anonymous).toBe(true);
	});
});

describe('POST /api/report: rate limit', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('anon: 5/hr per IP, 6th call → 429', async () => {
		const { postId } = await seedPost();
		const make = () =>
			postJSON('/api/report', {
				target_type: 'post',
				target_id: postId,
				reason: 'spam'
			});

		for (let i = 0; i < 5; i++) {
			const res = await make();
			await res.text();
			expect(res.status, `request ${i + 1} should pass`).toBe(200);
		}
		const sixth = await make();
		await sixth.text();
		expect(sixth.status).toBe(429);
	});

	it('authed: 20/hr per user is higher than the anon limit', async () => {
		const user = await makeUser({ username: 'rl-authed' });
		const { cookie } = await asUser(user);
		const { postId } = await seedPost();

		// Hit the anon ceiling worth of requests authed — should all pass.
		for (let i = 0; i < 6; i++) {
			const res = await postJSON(
				'/api/report',
				{ target_type: 'post', target_id: postId, reason: 'spam' },
				{ cookie }
			);
			await res.text();
			expect(res.status, `authed request ${i + 1} should pass`).toBe(200);
		}
	});
});
