// Integration: DB queries against abuse_reports — create, list, status
// updates, anonymous + authed reporting shapes.
import { describe, it, expect } from 'vitest';
import {
	createReport,
	getReportById,
	listReports,
	setReportStatus,
	targetExists
} from '$lib/db/reports';
import { db, schema } from '$lib/db/client';
import { createUserWithEmail } from '$lib/db/users';
import { makeUser, makeBlogWith } from '../setup/factories';
import { createPost, setPostStatus } from '$lib/db/posts';

describe('reports: create + read', () => {
	it('persists an anonymous report (reporter_user_id null, ip set)', async () => {
		const owner = await makeUser({ username: 'rep-owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'T',
			content: 'C',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n1',
			status: 'under_review'
		});

		const report = await createReport({
			reporterUserId: null,
			reporterIp: '203.0.113.42',
			targetType: 'post',
			targetId: r.post.id,
			reason: 'spam',
			details: 'looks like an ad'
		});

		expect(report.reporterUserId).toBeNull();
		expect(report.reporterIp).toBe('203.0.113.42');
		expect(report.status).toBe('open');

		const back = await getReportById(report.id);
		expect(back?.reason).toBe('spam');
		expect(back?.details).toBe('looks like an ad');
	});

	it('persists an authed report (reporter_user_id set, ip null)', async () => {
		const user = await createUserWithEmail('reporter@x.com', 'reporter');
		const owner = await makeUser({ username: 'auth-rep-owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'X',
			content: 'Y',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n2',
			status: 'under_review'
		});
		const report = await createReport({
			reporterUserId: user.id,
			reporterIp: null,
			targetType: 'post',
			targetId: r.post.id,
			reason: 'harassment'
		});
		expect(report.reporterUserId).toBe(user.id);
		expect(report.reporterIp).toBeNull();
	});
});

describe('reports: listReports', () => {
	it('filters by status and joins reporter username', async () => {
		const user = await createUserWithEmail('lister@x.com', 'lister');
		const owner = await makeUser({ username: 'lo' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'P',
			content: 'B',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np',
			status: 'under_review'
		});
		await createReport({
			reporterUserId: user.id,
			targetType: 'post',
			targetId: r.post.id,
			reason: 'spam'
		});
		await createReport({
			reporterUserId: null,
			reporterIp: '198.51.100.1',
			targetType: 'post',
			targetId: r.post.id,
			reason: 'malware'
		});

		const open = await listReports({ status: 'open' });
		expect(open.total).toBe(2);
		expect(open.items.length).toBe(2);
		const authed = open.items.find((it) => it.reporterUserId === user.id);
		expect(authed?.reporterUsername).toBe('lister');

		const resolved = await listReports({ status: 'resolved' });
		expect(resolved.total).toBe(0);
	});

	it('paginates with limit + offset', async () => {
		const owner = await makeUser({ username: 'pag' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'P',
			content: 'B',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np',
			status: 'under_review'
		});
		for (let i = 0; i < 5; i++) {
			await createReport({
				reporterIp: '127.0.0.1',
				targetType: 'post',
				targetId: r.post.id,
				reason: 'spam'
			});
		}
		const p1 = await listReports({ status: 'open', limit: 2, offset: 0 });
		const p2 = await listReports({ status: 'open', limit: 2, offset: 2 });
		expect(p1.items.length).toBe(2);
		expect(p2.items.length).toBe(2);
		expect(p1.total).toBe(5);
		expect(p1.items[0].id).not.toBe(p2.items[0].id);
	});
});

describe('reports: setReportStatus', () => {
	it('resolves with notes + resolver + timestamp', async () => {
		const op = await createUserWithEmail('op@x.com', 'op');
		const owner = await makeUser({ username: 'so' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'P',
			content: 'B',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np',
			status: 'under_review'
		});
		const report = await createReport({
			reporterIp: '127.0.0.1',
			targetType: 'post',
			targetId: r.post.id,
			reason: 'spam'
		});

		const updated = await setReportStatus({
			id: report.id,
			status: 'resolved',
			resolvedByUserId: op.id,
			resolutionNotes: 'deleted by hand'
		});
		expect(updated?.status).toBe('resolved');
		expect(updated?.resolvedByUserId).toBe(op.id);
		expect(updated?.resolutionNotes).toBe('deleted by hand');
		expect(updated?.resolvedAt).toBeInstanceOf(Date);
	});

	it('dismisses (terminal status) sets resolver + timestamp too', async () => {
		const op = await createUserWithEmail('op2@x.com', 'op2');
		const owner = await makeUser({ username: 'so2' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'P',
			content: 'B',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np',
			status: 'under_review'
		});
		const report = await createReport({
			reporterIp: '127.0.0.1',
			targetType: 'post',
			targetId: r.post.id,
			reason: 'other'
		});
		const updated = await setReportStatus({
			id: report.id,
			status: 'dismissed',
			resolvedByUserId: op.id,
			resolutionNotes: 'not actionable'
		});
		expect(updated?.status).toBe('dismissed');
		expect(updated?.resolvedAt).toBeInstanceOf(Date);
	});
});

describe('reports: targetExists', () => {
	it('returns true for an existing post + false for a missing one', async () => {
		const owner = await makeUser({ username: 'targ' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'P',
			content: 'B',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np',
			status: 'under_review'
		});
		expect(await targetExists('post', r.post.id)).toBe(true);
		expect(await targetExists('post', '00000000-0000-0000-0000-000000000000')).toBe(false);
	});

	it('returns true for an existing user + false otherwise', async () => {
		const u = await createUserWithEmail('te@x.com', 'te');
		expect(await targetExists('user', u.id)).toBe(true);
		expect(await targetExists('user', '00000000-0000-0000-0000-000000000000')).toBe(false);
	});

	it('returns true for an existing blog + comment', async () => {
		const owner = await makeUser({ username: 'tbg' });
		const { id: blogId } = await makeBlogWith({ owner });
		expect(await targetExists('blog', blogId)).toBe(true);
		const r = await createPost({
			blogId,
			title: 'P',
			content: 'B',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');
		const [c] = await db
			.insert(schema.postComments)
			.values({
				postVersionId: r.version.id,
				body: 'hi',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'cn'
			})
			.returning();
		expect(await targetExists('comment', c.id)).toBe(true);
	});
});
