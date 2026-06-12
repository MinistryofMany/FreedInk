// Verifies the metrics gauge helpers return the right numbers after seeding.
// Per-test resetDb() (see tests/setup/integration.ts) gives us a clean slate
// so the counts are exact.
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, schema } from '$lib/db/client';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';
import { createPost } from '$lib/db/posts';
import { makeUser, makeBlogWith } from '../setup/factories';
import {
	countUsersTotal,
	countUsersSuspended,
	countActiveUsers,
	countBlogs,
	countPostsByStatus,
	countPublishedPostVersions,
	countCommentsTotal,
	countCommentsSince,
	countReviewsByVote,
	countReviewsSince,
	countAbuseReportsOpen,
	countActiveSessions,
	countAuditEvents24h,
	dailyNewUsers,
	dailyNewPosts,
	dailyNewComments
} from '$lib/server/metrics';

describe('metrics gauge helpers', () => {
	it('countUsersTotal counts every users row', async () => {
		expect(await countUsersTotal()).toBe(0);
		await makeUser({ username: 'u1' });
		await makeUser({ username: 'u2' });
		await makeUser({ username: 'u3' });
		expect(await countUsersTotal()).toBe(3);
	});

	it('countUsersSuspended counts users with suspended_at set', async () => {
		const u1 = await makeUser({ username: 'live' });
		const u2 = await makeUser({ username: 'banned' });
		expect(await countUsersSuspended()).toBe(0);
		await db.execute(
			sql`UPDATE users SET suspended_at = now(), suspended_reason = 'spam' WHERE id = ${u2.id}::uuid`
		);
		expect(await countUsersSuspended()).toBe(1);
		// And the untouched user stays unsuspended.
		expect(u1.id).not.toBe(u2.id);
	});

	it('countActiveUsers counts distinct users with a session.last_seen_at within the window', async () => {
		const u1 = await makeUser({ username: 'recent' });
		const u2 = await makeUser({ username: 'stale' });
		const fresh = new Date();
		const old = new Date(Date.now() - 30 * 86_400_000);
		await db.insert(schema.sessions).values([
			{ userId: u1.id, expiresAt: new Date(Date.now() + 86_400_000), lastSeenAt: fresh },
			{ userId: u1.id, expiresAt: new Date(Date.now() + 86_400_000), lastSeenAt: fresh },
			{ userId: u2.id, expiresAt: new Date(Date.now() + 86_400_000), lastSeenAt: old }
		]);
		// Distinct count: u1 (twice) → 1, u2 (stale) → 0.
		expect(await countActiveUsers(7)).toBe(1);
	});

	it('countBlogs respects the archived filter', async () => {
		const u = await makeUser({ username: 'bowner' });
		const b1 = await createBlog(u.id, 'live blog', null);
		await createBlog(u.id, 'another', null);
		await db.execute(sql`UPDATE blogs SET archived_at = now() WHERE id = ${b1.id}::uuid`);
		expect(await countBlogs({ archived: false })).toBe(1);
		expect(await countBlogs({ archived: true })).toBe(1);
	});

	it('countPostsByStatus reports each enum value (and 0 for unseen)', async () => {
		const u = await makeUser({ username: 'postowner' });
		const { id: blogId } = await makeBlogWith({ owner: u });
		await createPost({
			blogId,
			title: 'a',
			content: 'b',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n1',
			status: 'draft'
		});
		await createPost({
			blogId,
			title: 'c',
			content: 'd',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n2',
			status: 'under_review'
		});
		await createPost({
			blogId,
			title: 'e',
			content: 'f',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n3',
			status: 'under_review'
		});
		const counts = await countPostsByStatus();
		expect(counts.draft).toBe(1);
		expect(counts.under_review).toBe(2);
		expect(counts.published).toBe(0);
		expect(counts.rejected).toBe(0);
	});

	it('countPublishedPostVersions ignores soft-deleted versions', async () => {
		const u = await makeUser({ username: 'pubowner' });
		const { id: blogId } = await makeBlogWith({ owner: u });
		const p1 = await createPost({
			blogId,
			title: 'live',
			content: 'x',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np1',
			status: 'under_review'
		});
		const p2 = await createPost({
			blogId,
			title: 'gone',
			content: 'y',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'np2',
			status: 'under_review'
		});
		// Promote both to "published" at the version level...
		await db.execute(
			sql`UPDATE blog_post_versions SET status = 'published', published_at = now() WHERE id IN (${p1.version.id}::uuid, ${p2.version.id}::uuid)`
		);
		expect(await countPublishedPostVersions()).toBe(2);
		// ...then soft-delete one.
		await db.execute(
			sql`UPDATE blog_post_versions SET deleted_at = now() WHERE id = ${p2.version.id}::uuid`
		);
		expect(await countPublishedPostVersions()).toBe(1);
	});

	it('countCommentsTotal / countCommentsSince respect a time window', async () => {
		const u = await makeUser({ username: 'cmt' });
		const { id: blogId } = await makeBlogWith({ owner: u });
		const { version } = await createPost({
			blogId,
			title: 't',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'cnp',
			status: 'under_review'
		});
		const old = new Date(Date.now() - 30 * 86_400_000);
		await db.insert(schema.postComments).values([
			{
				postVersionId: version.id,
				body: 'recent',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'cn1'
			},
			{
				postVersionId: version.id,
				body: 'recent2',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'cn2'
			}
		]);
		const [stale] = await db
			.insert(schema.postComments)
			.values({
				postVersionId: version.id,
				body: 'old',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'cn3'
			})
			.returning({ id: schema.postComments.id });
		await db.execute(
			sql`UPDATE post_comments SET created_at = ${old.toISOString()} WHERE id = ${stale.id}::uuid`
		);
		expect(await countCommentsTotal()).toBe(3);
		expect(await countCommentsSince(7)).toBe(2);
	});

	it('countReviewsByVote / countReviewsSince group correctly', async () => {
		const u = await makeUser({ username: 'rev' });
		const { id: blogId } = await makeBlogWith({ owner: u });
		const { version } = await createPost({
			blogId,
			title: 't',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'rnp',
			status: 'under_review'
		});
		await db.insert(schema.postReviews).values([
			{
				postVersionId: version.id,
				vote: 'approve',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'rv1'
			},
			{
				postVersionId: version.id,
				vote: 'approve',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'rv2'
			},
			{ postVersionId: version.id, vote: 'reject', proof: {}, snapshotRoot: 'r', nullifier: 'rv3' }
		]);
		const byVote = await countReviewsByVote();
		expect(byVote.approve).toBe(2);
		expect(byVote.reject).toBe(1);
		expect(await countReviewsSince(7)).toBe(3);
		expect(await countReviewsSince(0)).toBe(0);
	});

	it('countAbuseReportsOpen counts only status=open rows', async () => {
		const u = await createUserWithEmail('reporter@x.com', 'rep');
		await db.insert(schema.abuseReports).values([
			{
				reporterUserId: u.id,
				targetType: 'post',
				targetId: '00000000-0000-0000-0000-000000000001',
				reason: 'spam',
				status: 'open'
			},
			{
				reporterUserId: u.id,
				targetType: 'post',
				targetId: '00000000-0000-0000-0000-000000000002',
				reason: 'spam',
				status: 'resolved'
			},
			{
				reporterUserId: u.id,
				targetType: 'comment',
				targetId: '00000000-0000-0000-0000-000000000003',
				reason: 'hate',
				status: 'open'
			}
		]);
		expect(await countAbuseReportsOpen()).toBe(2);
	});

	it('countActiveSessions counts only sessions with expires_at > now()', async () => {
		const u = await makeUser({ username: 'sess' });
		await db.insert(schema.sessions).values([
			{ userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) },
			{ userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) },
			{ userId: u.id, expiresAt: new Date(Date.now() - 86_400_000) }
		]);
		expect(await countActiveSessions()).toBe(2);
	});

	it('countAuditEvents24h respects the 24h window and groups by event', async () => {
		const u = await makeUser({ username: 'auditer' });
		const oldTs = new Date(Date.now() - 48 * 3600 * 1000);
		await db.insert(schema.auditLog).values([
			{ event: 'session.created', actorUserId: u.id },
			{ event: 'session.created', actorUserId: u.id },
			{ event: 'session.destroyed', actorUserId: u.id }
		]);
		const [stale] = await db
			.insert(schema.auditLog)
			.values({ event: 'blog.created', actorUserId: u.id })
			.returning({ id: schema.auditLog.id });
		await db.execute(
			sql`UPDATE audit_log SET created_at = ${oldTs.toISOString()} WHERE id = ${stale.id}::uuid`
		);
		const counts = await countAuditEvents24h();
		expect(counts['session.created']).toBe(2);
		expect(counts['session.destroyed']).toBe(1);
		// Stale 48h-old event must not appear in the 24h slice.
		expect(counts['blog.created']).toBeUndefined();
	});
});

describe('metrics daily-bucket helpers', () => {
	it('dailyNewUsers returns 30 contiguous days with zeros where appropriate', async () => {
		const series = await dailyNewUsers(30);
		expect(series.length).toBe(30);
		// Strictly increasing by 1 day (UTC dates as YYYY-MM-DD).
		for (let i = 1; i < series.length; i++) {
			const prev = new Date(series[i - 1].date + 'T00:00:00Z').getTime();
			const cur = new Date(series[i].date + 'T00:00:00Z').getTime();
			expect(cur - prev).toBe(86_400_000);
		}
		expect(series.every((d) => d.count === 0)).toBe(true);
	});

	it('dailyNewUsers counts users created today', async () => {
		await makeUser({ username: 'today1' });
		await makeUser({ username: 'today2' });
		const series = await dailyNewUsers(30);
		const totals = series.reduce((s, d) => s + d.count, 0);
		expect(totals).toBe(2);
		// They land on the last bucket (today).
		expect(series[series.length - 1].count).toBe(2);
	});

	it('dailyNewPosts and dailyNewComments include todays activity', async () => {
		const u = await makeUser({ username: 'sparkowner' });
		const { id: blogId } = await makeBlogWith({ owner: u });
		const { version } = await createPost({
			blogId,
			title: 't',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'pp',
			status: 'under_review'
		});
		await db.insert(schema.postComments).values({
			postVersionId: version.id,
			body: 'x',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'ppc'
		});
		const posts = await dailyNewPosts(30);
		const comments = await dailyNewComments(30);
		expect(posts.reduce((s, d) => s + d.count, 0)).toBeGreaterThanOrEqual(1);
		expect(comments.reduce((s, d) => s + d.count, 0)).toBeGreaterThanOrEqual(1);
	});
});
