// Audit-log integration: exercise endpoints that emit audit events and assert
// the matching audit_log rows show up. This test deliberately hits the API
// (not the DB helpers) because the audit calls live in the route handlers,
// not in $lib/db/*.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, eq, desc } from 'drizzle-orm';
import { asUser, postJSON } from './helpers';
import { makeUser, makeBlogWith, buildTestProof } from '../setup/factories';
import { BASE_URL } from '../setup/server';
import type { AuditEvent } from '$lib/server/audit';

async function eventsFor(actor: string): Promise<AuditEvent[]> {
	const rows = await db
		.select({ event: schema.auditLog.event })
		.from(schema.auditLog)
		.where(eq(schema.auditLog.actorUserId, actor))
		.orderBy(desc(schema.auditLog.createdAt));
	return rows.map((r) => r.event);
}

async function lastEvent(filter: { actor?: string; subjectBlog?: string }) {
	const conds = [];
	if (filter.actor) conds.push(eq(schema.auditLog.actorUserId, filter.actor));
	if (filter.subjectBlog) conds.push(eq(schema.auditLog.subjectBlogId, filter.subjectBlog));
	const rows = await db
		.select()
		.from(schema.auditLog)
		.where(conds.length === 1 ? conds[0] : and(...conds))
		.orderBy(desc(schema.auditLog.createdAt))
		.limit(1);
	return rows[0] ?? null;
}

describe('audit log: blog.created', () => {
	it('records when an owner creates a blog', async () => {
		const owner = await makeUser({ username: 'audit-owner' });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/create',
			{ title: 'Audit Blog', description: null },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const { id } = await res.json();
		const evt = await lastEvent({ actor: owner.id, subjectBlog: id });
		expect(evt?.event).toBe('blog.created');
		expect((evt?.metadata as Record<string, unknown>)?.slug).toBe('audit-blog');
	});
});

describe('audit log: blog.member_added / removed / role_changed', () => {
	it('emits member_added when a new role is set', async () => {
		const owner = await makeUser({ username: 'audit-mo' });
		const target = await makeUser({ username: 'audit-mt' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/members',
			{ blog_id: blog.id, target: { username: 'audit-mt' }, role: 'author' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const evt = await lastEvent({ actor: owner.id, subjectBlog: blog.id });
		expect(evt?.event).toBe('blog.member_added');
		expect(evt?.subjectUserId).toBe(target.id);
		expect((evt?.metadata as Record<string, unknown>)?.role).toBe('author');
	});

	it('emits member_role_changed when an existing role is updated', async () => {
		const owner = await makeUser({ username: 'audit-mo2' });
		const target = await makeUser({ username: 'audit-mt2' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: target, role: 'commenter' }]
		});
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/members',
			{ blog_id: blog.id, target: { username: 'audit-mt2' }, role: 'author' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const evt = await lastEvent({ actor: owner.id, subjectBlog: blog.id });
		expect(evt?.event).toBe('blog.member_role_changed');
		expect((evt?.metadata as Record<string, unknown>)?.previous_role).toBe('commenter');
		expect((evt?.metadata as Record<string, unknown>)?.role).toBe('author');
	});

	it('emits member_removed on DELETE', async () => {
		const owner = await makeUser({ username: 'audit-mo3' });
		const target = await makeUser({ username: 'audit-mt3' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: target, role: 'reviewer' }]
		});
		const { cookie } = await asUser(owner);
		const res = await fetch(`${BASE_URL}/api/blog/members`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ blog_id: blog.id, target_user_id: target.id })
		});
		expect(res.status).toBe(200);
		const evt = await lastEvent({ actor: owner.id, subjectBlog: blog.id });
		expect(evt?.event).toBe('blog.member_removed');
		expect(evt?.subjectUserId).toBe(target.id);
	});
});

describe('audit log: blog.archived / unarchived', () => {
	it('records archive then unarchive', async () => {
		const owner = await makeUser({ username: 'audit-arch' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const r1 = await postJSON('/api/blog/archive', { blog_id: blog.id, archive: true }, { cookie });
		expect(r1.status).toBe(200);
		const e1 = await lastEvent({ actor: owner.id, subjectBlog: blog.id });
		expect(e1?.event).toBe('blog.archived');
		const r2 = await postJSON(
			'/api/blog/archive',
			{ blog_id: blog.id, archive: false },
			{ cookie }
		);
		expect(r2.status).toBe(200);
		const e2 = await lastEvent({ actor: owner.id, subjectBlog: blog.id });
		expect(e2?.event).toBe('blog.unarchived');
	});
});

describe('audit log: post.submitted, review.cast, post.published', () => {
	it('emits post.submitted on submission and post.published on threshold flip', async () => {
		// Re-use seeds the blog-flow test verified work (their commitments
		// happen to lex-sort in the same order as user-creation-date, which
		// is the implicit assumption baked into buildTestProof). Picking
		// arbitrary new seeds risks a mismatch between the snapshot's leaf
		// order and the proof's leaf order — different Merkle roots, which
		// the server rejects as "unknown snapshot".
		const owner = await makeUser({ username: 'audit-po', seed: 'owner-seed' });
		const rev1 = await makeUser({ username: 'audit-r1', seed: 'rev1-seed' });
		const rev2 = await makeUser({ username: 'audit-r2', seed: 'rev2-seed' });
		const blog = await makeBlogWith({
			owner,
			members: [
				{ user: rev1, role: 'reviewer' },
				{ user: rev2, role: 'reviewer' }
			]
		});
		const ownerSess = await asUser(owner);

		// Submit a post for review with a real Semaphore proof.
		const proof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'Audit Post\n\nbody'
		});
		const submit = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'Audit Post',
				content: 'body',
				proof,
				submit_for_review: true
			},
			{ cookie: ownerSess.cookie }
		);
		if (submit.status !== 200) {
			const body = await submit.text();
			throw new Error(`submit failed ${submit.status}: ${body}`);
		}
		const { version_id } = await submit.json();

		const events = await eventsFor(owner.id);
		expect(events).toContain('post.submitted');

		// rev1 votes approve.
		const rev1Sess = await asUser(rev1);
		const p1 = await buildTestProof({
			blogId: blog.id,
			identity: rev1.identity,
			scope: `review:${version_id}`,
			message: 'approve'
		});
		const v1 = await postJSON(
			'/api/post/review',
			{ post_version_id: version_id, vote: 'approve', proof: p1 },
			{ cookie: rev1Sess.cookie }
		);
		expect(v1.status).toBe(200);
		const ev1 = await eventsFor(rev1.id);
		expect(ev1).toContain('review.cast');
		expect(ev1).not.toContain('post.published');

		// rev2 votes approve → flip to published.
		const rev2Sess = await asUser(rev2);
		const p2 = await buildTestProof({
			blogId: blog.id,
			identity: rev2.identity,
			scope: `review:${version_id}`,
			message: 'approve'
		});
		const v2 = await postJSON(
			'/api/post/review',
			{ post_version_id: version_id, vote: 'approve', proof: p2 },
			{ cookie: rev2Sess.cookie }
		);
		expect(v2.status).toBe(200);
		const ev2 = await eventsFor(rev2.id);
		expect(ev2).toContain('review.cast');
		expect(ev2).toContain('post.published');
	}, 120_000);
});

describe('audit log: comment.posted', () => {
	it('records when a comment is posted on a published version', async () => {
		const owner = await makeUser({ username: 'audit-co', seed: 'audit-co-seed' });
		const blog = await makeBlogWith({ owner });
		const ownerSess = await asUser(owner);

		// Create a draft (no review needed for `submit_for_review: false`).
		const proof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'C\n\nbody'
		});
		const sub = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'C',
				content: 'body',
				proof,
				submit_for_review: false
			},
			{ cookie: ownerSess.cookie }
		);
		expect(sub.status).toBe(200);
		const { version_id } = await sub.json();

		const cproof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `comment:${version_id}`,
			message: 'nice'
		});
		const c = await postJSON(
			'/api/post/comment',
			{ post_version_id: version_id, body: 'nice', proof: cproof },
			{ cookie: ownerSess.cookie }
		);
		expect(c.status).toBe(200);
		const events = await eventsFor(owner.id);
		expect(events).toContain('comment.posted');
	}, 90_000);
});

describe('audit log: session.destroyed on signout', () => {
	it('records signout for a logged-in user', async () => {
		const u = await makeUser({ username: 'audit-out' });
		const { cookie } = await asUser(u);
		const res = await fetch(`${BASE_URL}/api/signout`, {
			method: 'POST',
			headers: { cookie }
		});
		expect(res.status).toBe(200);
		const events = await eventsFor(u.id);
		expect(events).toContain('session.destroyed');
	});
});

describe('audit log: identity.created', () => {
	it('records when a user installs their first identity', async () => {
		// makeUser inserts an identity directly, so spin up a brand-new
		// user-with-wallet (no identity) and POST through the endpoint.
		const wallet = '0x' + 'a'.repeat(40);
		// Create a user with a wallet but no identity row.
		const [u] = await db.insert(schema.users).values({ username: 'audit-id-user' }).returning();
		await db.insert(schema.walletAddresses).values({ userId: u.id, address: wallet });

		const { createSession, packCookie } = await import('$lib/server/session');
		const sid = await createSession(u.id, { userAgent: 'vitest', ip: '127.0.0.1' });
		const cookie = `sid=${packCookie(sid)}`;

		const res = await postJSON(
			'/api/identity',
			{
				idc: '12345',
				public_key: '[1,2]',
				ciphertext: 'AA',
				salt: 'AA',
				nonce: 'AA',
				kdf: 'pbkdf2-sha256',
				kdf_params: { name: 'PBKDF2', iterations: 600_000, hash: 'SHA-256' }
			},
			{ cookie }
		);
		expect(res.status).toBe(200);
		const events = await eventsFor(u.id);
		expect(events).toContain('identity.created');
	});
});
