// End-to-end API flow: blog creation → invite members → post with real
// Semaphore proof → review by other members → auto-publish → comment.
import { describe, it, expect } from 'vitest';
import { asUser, postJSON, getJSON } from './helpers';
import { makeUser, makeBlogWith, buildTestProof } from '../setup/factories';
import { refreshSnapshot } from '$lib/db/snapshots';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';

describe('blog create', () => {
	it('rejects bad input with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { cookie } = await asUser(owner);
		const res = await postJSON('/api/blog/create', { description: 'missing title' }, { cookie });
		expect(res.status).toBe(422);
	});

	it('creates a blog and returns its slug', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/create',
			{ title: 'Cool Blog', description: 'desc' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.slug).toBe('cool-blog');
		expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
	});
});

describe('blog/group', () => {
	it('non-member receives 403', async () => {
		const owner = await makeUser({ username: 'owner' });
		const stranger = await makeUser({ username: 'stranger' });
		const blog = await makeBlogWith({ owner });
		await refreshSnapshot(blog.id, 'author');
		const { cookie } = await asUser(stranger);
		const res = await postJSON(
			'/api/blog/group',
			{ blog_slug: blog.slug, capability: 'author' },
			{ cookie }
		);
		expect(res.status).toBe(403);
	});

	it('member receives the author-tree identities', async () => {
		const owner = await makeUser({ username: 'owner' });
		const author = await makeUser({ username: 'author' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: author, role: 'author' }]
		});
		const { cookie } = await asUser(author);
		const res = await postJSON(
			'/api/blog/group',
			{ blog_slug: blog.slug, capability: 'author' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.identities).toContain(owner.identity.commitment.toString());
		expect(json.identities).toContain(author.identity.commitment.toString());
		expect(json.eligible_count).toBe(2);
	});

	it('an author requesting the REVIEW tree is forbidden (R1: only your own trees)', async () => {
		const owner = await makeUser({ username: 'owner' });
		const author = await makeUser({ username: 'author' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: author, role: 'author' }]
		});
		const { cookie } = await asUser(author);
		// The author holds can_author + can_comment but NOT can_review, so the
		// review tree fetch is 403 — a member can only fetch the trees they hold.
		const res = await postJSON(
			'/api/blog/group',
			{ blog_slug: blog.slug, capability: 'review' },
			{ cookie }
		);
		expect(res.status).toBe(403);
	});

	it('rejects a missing/invalid capability with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const res = await postJSON('/api/blog/group', { blog_slug: blog.slug }, { cookie });
		expect(res.status).toBe(422);
	});

	it('unknown blog → 404', async () => {
		const u = await makeUser({ username: 'u' });
		const { cookie } = await asUser(u);
		const res = await postJSON(
			'/api/blog/group',
			{ blog_slug: 'nope', capability: 'author' },
			{ cookie }
		);
		expect(res.status).toBe(404);
	});
});

describe('blog/members', () => {
	it('non-owner cannot change roles', async () => {
		const owner = await makeUser({ username: 'owner' });
		const editor = await makeUser({ username: 'editor' });
		const target = await makeUser({ username: 'target' });
		const blog = await makeBlogWith({
			owner,
			members: [
				{ user: editor, role: 'editor' },
				{ user: target, role: 'author' }
			]
		});
		const { cookie } = await asUser(editor);
		const res = await postJSON(
			'/api/blog/members',
			{ blog_id: blog.id, target: { username: 'target' }, role: 'reviewer' },
			{ cookie }
		);
		expect(res.status).toBe(403);
	});

	it('owner can change a role and refresh the snapshot', async () => {
		const owner = await makeUser({ username: 'owner' });
		const target = await makeUser({ username: 'target' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: target, role: 'commenter' }]
		});
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/members',
			{ blog_id: blog.id, target: { username: 'target' }, role: 'reviewer' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.member.role).toBe('reviewer');

		// Target is now a reviewer → in the REVIEW tree. Fetch it (owner holds all
		// capabilities so may fetch any tree) and assert the target's commitment.
		const group = await postJSON(
			'/api/blog/group',
			{ blog_slug: blog.slug, capability: 'review' },
			{ cookie }
		);
		const g = await group.json();
		expect(g.identities).toContain(target.identity.commitment.toString());
		// And NOT in the author tree (a reviewer can't author).
		const authorGroup = await postJSON(
			'/api/blog/group',
			{ blog_slug: blog.slug, capability: 'author' },
			{ cookie }
		);
		const ag = await authorGroup.json();
		expect(ag.identities).not.toContain(target.identity.commitment.toString());
	});

	it('owner cannot remove themselves', async () => {
		const owner = await makeUser({ username: 'owner' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const res = await fetch(
			`http://${'127.0.0.1'}:${process.env.TEST_SERVER_PORT ?? 5174}/api/blog/members`,
			{
				method: 'DELETE',
				headers: { 'content-type': 'application/json', cookie },
				body: JSON.stringify({ blog_id: blog.id, target_user_id: owner.id })
			}
		);
		expect(res.status).toBe(409);
	});
});

describe('identity flow', () => {
	it('GET /api/identity returns the encrypted blob for the signed-in user', async () => {
		const user = await makeUser({ username: 'u' });
		const { cookie } = await asUser(user);
		const res = await getJSON('/api/identity', { cookie });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.identity.idc).toBe(user.identity.commitment.toString());
		expect(json.identity.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(json.identity.kdf).toBe('pbkdf2-sha256');
	});

	it('POST /api/identity enrolls a SECOND device (per-device model, Phase 3)', async () => {
		// makeUser already installed device #1. Enrolling a distinct commitment as a
		// second device now succeeds (the old single-active 409 block is gone).
		const user = await makeUser({ username: 'u' });
		const { cookie } = await asUser(user);
		const res = await postJSON(
			'/api/identity',
			{
				idc: '12345678901234567890',
				public_key: '[1,2]',
				ciphertext: 'AA',
				salt: 'AA',
				nonce: 'AA',
				kdf: 'pbkdf2-sha256',
				kdf_params: { name: 'PBKDF2', iterations: 600_000, hash: 'SHA-256' },
				device_label: 'second-device'
			},
			{ cookie }
		);
		expect(res.status).toBe(200);
		// Both devices are now active.
		const list = await getJSON('/api/identity', { cookie });
		const json = await list.json();
		expect(json.identities).toHaveLength(2);
	});
});

describe('session-free writes (Phase 4)', () => {
	it('a valid writers proof with NO cookie creates a post (200)', async () => {
		const owner = await makeUser({ username: 'sf-owner', seed: 'sf-owner-seed' });
		const blog = await makeBlogWith({ owner });
		const proof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'No Cookie Post\n\nbody',
			capability: 'author'
		});
		// NO cookie passed — authorization is purely the proof.
		const res = await postJSON('/api/blog/post', {
			blog_slug: blog.slug,
			title: 'No Cookie Post',
			content: 'body',
			proof,
			submit_for_review: true
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.ok).toBe(true);
	}, 60_000);

	it('a wrong-tree proof (comment proof to the post endpoint) is rejected (400)', async () => {
		const owner = await makeUser({ username: 'sf-wrong', seed: 'sf-wrong-seed' });
		const commenter = await makeUser({ username: 'sf-com', seed: 'sf-com-seed' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: commenter, role: 'commenter' }]
		});
		// Build a COMMENT-tree proof (commenter is in the comment tree, not author)
		// but submit it to the post endpoint, whose scope is post:<blog>. The scope
		// won't match AND the comment root isn't a writers root → 400.
		const proof = await buildTestProof({
			blogId: blog.id,
			identity: commenter.identity,
			scope: `comment:x`,
			message: 'x',
			capability: 'comment'
		});
		const res = await postJSON('/api/blog/post', {
			blog_slug: blog.slug,
			title: 'x',
			content: 'x',
			proof
		});
		expect(res.status).toBe(400);
	}, 60_000);

	it('a present cookie is ignored (not required, not rejected)', async () => {
		const owner = await makeUser({ username: 'sf-cookie', seed: 'sf-cookie-seed' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const proof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'With Cookie\n\nbody',
			capability: 'author'
		});
		const res = await postJSON(
			'/api/blog/post',
			{ blog_slug: blog.slug, title: 'With Cookie', content: 'body', proof },
			{ cookie }
		);
		expect(res.status).toBe(200);
	}, 60_000);
});

describe('full flow: post → vote → publish → comment', () => {
	it('publishes a post when approvals reach threshold and rejects nullifier reuse', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const rev1 = await makeUser({ username: 'rev1', seed: 'rev1-seed' });
		const rev2 = await makeUser({ username: 'rev2', seed: 'rev2-seed' });
		const blog = await makeBlogWith({
			owner,
			members: [
				{ user: rev1, role: 'reviewer' },
				{ user: rev2, role: 'reviewer' }
			]
		});

		// 1) Author (owner) submits a post under review with a real proof.
		const postProof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'My Title\n\nMy body content'
		});
		const ownerSess = await asUser(owner);
		const submitRes = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'My Title',
				content: 'My body content',
				proof: postProof,
				submit_for_review: true
			},
			{ cookie: ownerSess.cookie }
		);
		expect(submitRes.status).toBe(200);
		const { post_id, version_id } = await submitRes.json();

		// 2) Re-submitting the same proof creates a *different* post (current
		//    design: nullifier on blog_post_versions is unique per post_id, not
		//    globally, so an identity can submit multiple distinct posts in a
		//    blog using the same scope). The new post gets its own UUID.
		const dup = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'My Title',
				content: 'My body content',
				proof: postProof,
				submit_for_review: true
			},
			{ cookie: ownerSess.cookie }
		);
		expect(dup.status).toBe(200);
		const dupJson = await dup.json();
		expect(dupJson.post_id).not.toBe(post_id);

		// 3) First reviewer approves.
		const rev1Sess = await asUser(rev1);
		const rev1Proof = await buildTestProof({
			blogId: blog.id,
			identity: rev1.identity,
			scope: `review:${version_id}`,
			message: 'approve'
		});
		const vote1 = await postJSON(
			'/api/post/review',
			{ post_version_id: version_id, vote: 'approve', proof: rev1Proof },
			{ cookie: rev1Sess.cookie }
		);
		expect(vote1.status).toBe(200);
		const vote1Json = await vote1.json();
		expect(vote1Json.approves).toBe(1);
		expect(vote1Json.status).toBe('under_review');
		expect(vote1Json.threshold).toBe(2); // ceil(2/3 * 3) = 2

		// 4) Re-submitting the same vote upserts on the reviewer's stable
		// nullifier (change-vote semantics) — it does NOT double-count.
		const dupVote = await postJSON(
			'/api/post/review',
			{ post_version_id: version_id, vote: 'approve', proof: rev1Proof },
			{ cookie: rev1Sess.cookie }
		);
		expect(dupVote.status).toBe(200);
		expect((await dupVote.json()).approves).toBe(1);

		// 5) Second reviewer approves → auto-publish.
		const rev2Sess = await asUser(rev2);
		const rev2Proof = await buildTestProof({
			blogId: blog.id,
			identity: rev2.identity,
			scope: `review:${version_id}`,
			message: 'approve'
		});
		const vote2 = await postJSON(
			'/api/post/review',
			{ post_version_id: version_id, vote: 'approve', proof: rev2Proof },
			{ cookie: rev2Sess.cookie }
		);
		expect(vote2.status).toBe(200);
		const vote2Json = await vote2.json();
		expect(vote2Json.status).toBe('published');

		// 5b) Voting is closed once published — a further vote is rejected.
		// Reuse rev1's approve proof (message binds to 'approve') so we reach
		// the voting-window guard rather than failing message-binding.
		const lateVote = await postJSON(
			'/api/post/review',
			{ post_version_id: version_id, vote: 'approve', proof: rev1Proof },
			{ cookie: rev1Sess.cookie }
		);
		expect(lateVote.status).toBe(409);

		// 6) Post appears on the public blog page now.
		const publicRes = await fetch(
			`http://127.0.0.1:${process.env.TEST_SERVER_PORT ?? 5174}/b/${blog.slug}`
		);
		expect(publicRes.status).toBe(200);
		const html = await publicRes.text();
		expect(html).toContain('My Title');

		// 7) Comment with a fresh proof under the comment scope.
		const commentProof = await buildTestProof({
			blogId: blog.id,
			identity: rev1.identity,
			scope: `comment:${version_id}`,
			message: 'great post'
		});
		const c = await postJSON(
			'/api/post/comment',
			{ post_version_id: version_id, body: 'great post', proof: commentProof },
			{ cookie: rev1Sess.cookie }
		);
		expect(c.status).toBe(200);

		// 8) Second comment with same proof → 409 nullifier reuse.
		const c2 = await postJSON(
			'/api/post/comment',
			{ post_version_id: version_id, body: 'great post', proof: commentProof },
			{ cookie: rev1Sess.cookie }
		);
		expect(c2.status).toBe(409);

		// 9) Confirm DB-side: 1 published version, 2 approve reviews, 1 comment.
		const postRow = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, post_id))
			.limit(1);
		expect(postRow[0].status).toBe('published');
		const reviews = await db
			.select()
			.from(schema.postReviews)
			.where(eq(schema.postReviews.postVersionId, version_id));
		expect(reviews.length).toBe(2);
		const comments = await db
			.select()
			.from(schema.postComments)
			.where(eq(schema.postComments.postVersionId, version_id));
		expect(comments.length).toBe(1);
	}, 90_000);
});

describe('post-tags + archive', () => {
	it('writer can tag a draft post, owner can archive the blog', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);

		const proof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'Tagged\n\nbody'
		});
		const post = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'Tagged',
				content: 'body',
				proof,
				submit_for_review: false
			},
			{ cookie }
		);
		expect(post.status).toBe(200);
		const { post_id } = await post.json();

		const tagged = await postJSON(
			'/api/post/tags',
			{ post_id, tags: ['privacy', 'crypto'] },
			{ cookie }
		);
		expect(tagged.status).toBe(200);
		const tagsJson = await tagged.json();
		expect(tagsJson.tags.map((t: { slug: string }) => t.slug).sort()).toEqual([
			'crypto',
			'privacy'
		]);

		// Archive blog
		const arch = await postJSON(
			'/api/blog/archive',
			{ blog_id: blog.id, archive: true },
			{ cookie }
		);
		expect(arch.status).toBe(200);

		// Listing /b should no longer show it
		const listing = await fetch(`http://127.0.0.1:${process.env.TEST_SERVER_PORT ?? 5174}/b`);
		const html = await listing.text();
		expect(html).not.toContain(blog.slug);
	}, 60_000);
});
