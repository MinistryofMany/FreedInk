import { describe, it, expect } from 'vitest';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog, getBlogById } from '$lib/db/blogs';
import {
	listMembers,
	listPublicMembers,
	getActiveMember,
	setRole,
	removeMember,
	isFirstOwner
} from '$lib/db/members';
import {
	refreshSnapshot,
	refreshAllSnapshots,
	getSnapshotByRoot,
	refreshSnapshotsForUser,
	currentMembership
} from '$lib/db/snapshots';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { Identity } from '@semaphore-protocol/identity';

// One-root model: a user's commitment is per (user, blog). Enrollment therefore
// happens AFTER the blog exists (mirroring /api/identity/enroll), and every blog
// gives the same user a distinct commitment.
function perBlogIdentity(seed: string, blogId: string): Identity {
	return new Identity(`${new Identity(seed).export()}:${blogId}`);
}

async function installIdentity(userId: string, blogId: string, seed: string) {
	const id = perBlogIdentity(seed, blogId);
	await db.insert(schema.userIdentities).values({
		userId,
		blogId,
		idc: id.commitment.toString(),
		anonEpoch: 1,
		status: 'active'
	});
	await refreshAllSnapshots(blogId);
	return id;
}

// Replace a user's per-blog leaf (re-key) at the next epoch.
async function rotateIdentity(userId: string, blogId: string, seed: string) {
	const id = perBlogIdentity(seed, blogId);
	await db.transaction(async (tx) => {
		await tx
			.update(schema.userIdentities)
			.set({ idc: id.commitment.toString(), anonEpoch: 2 })
			.where(
				and(
					eq(schema.userIdentities.userId, userId),
					eq(schema.userIdentities.blogId, blogId),
					eq(schema.userIdentities.status, 'active')
				)
			);
	});
	return id;
}

describe('createBlog', () => {
	it('inserts the blog, makes the creator the owner, and seeds a snapshot per tree', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id, slug } = await createBlog(owner.id, 'My Blog', 'desc');
		expect(slug).toBe('my-blog');

		const blog = await getBlogById(id);
		expect(blog?.title).toBe('My Blog');

		const members = await listMembers(id);
		expect(members).toHaveLength(1);
		expect(members[0].role).toBe('owner');
		expect(members[0].user.id).toBe(owner.id);

		// createBlog seeds one snapshot per tree capability (author, comment). At
		// creation the owner has not yet enrolled a per-blog commitment, so the seeded
		// snapshots are empty; enrolling the owner then adds a single leaf.
		await installIdentity(owner.id, id, 'owner-id-seed');
		for (const cap of ['author', 'comment'] as const) {
			const cur = await currentMembership(id, cap);
			expect(cur.eligibleCount).toBe(1);
			expect(cur.identities).toHaveLength(1);
		}
	});
});

describe('listPublicMembers', () => {
	it('returns joined members with only non-sensitive fields and no email', async () => {
		const owner = await createUserWithEmail('owner@secret.example', 'pub-owner');
		const author = await createUserWithEmail('author@secret.example', 'pub-author');

		const { id: blogId } = await createBlog(owner.id, 'Pub Blog', null);
		await installIdentity(owner.id, blogId, 'pub-owner');
		await setRole(blogId, author.id, 'author', owner.id);
		await installIdentity(author.id, blogId, 'pub-author');

		const members = await listPublicMembers(blogId);
		expect(members).toHaveLength(2);

		const keys = Object.keys(members[0]).sort();
		expect(keys).toEqual(['canAuthor', 'displayName', 'joinedAt', 'role', 'username']);
		for (const m of members) {
			expect(typeof m.canAuthor).toBe('boolean');
			expect(m).not.toHaveProperty('email');
			expect(m).not.toHaveProperty('id');
			expect(m).not.toHaveProperty('userId');
		}
		const usernames = members.map((m) => m.username).sort();
		expect(usernames).toEqual(['pub-author', 'pub-owner']);
	});

	it('excludes removed members (removed_at IS NOT NULL)', async () => {
		const owner = await createUserWithEmail('o@x.example', 'pub-o2');
		const author = await createUserWithEmail('a@x.example', 'pub-a2');

		const { id: blogId } = await createBlog(owner.id, 'B2', null);
		await installIdentity(owner.id, blogId, 'pub-o2');
		await setRole(blogId, author.id, 'author', owner.id);
		await installIdentity(author.id, blogId, 'pub-a2');
		expect(await listPublicMembers(blogId)).toHaveLength(2);

		await removeMember(blogId, author.id);
		const remaining = await listPublicMembers(blogId);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].username).toBe('pub-o2');
	});
});

describe('setRole', () => {
	it('rotates a member from author to reviewer (single active row)', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const author = await createUserWithEmail('a@x.com', 'author');

		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');
		await setRole(blogId, author.id, 'author', owner.id);
		await installIdentity(author.id, blogId, 'author');

		let active = await getActiveMember(blogId, author.id);
		expect(active?.role).toBe('author');

		await setRole(blogId, author.id, 'reviewer', owner.id);
		active = await getActiveMember(blogId, author.id);
		expect(active?.role).toBe('reviewer');

		const allRows = await db
			.select()
			.from(schema.blogMembers)
			.where(and(eq(schema.blogMembers.blogId, blogId), eq(schema.blogMembers.userId, author.id)));
		expect(allRows).toHaveLength(2);
		expect(allRows.filter((r) => r.removedAt === null)).toHaveLength(1);
	});

	it('grows the author + comment trees when adding an author', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');

		const author = await createUserWithEmail('a@x.com', 'author');
		await setRole(blogId, author.id, 'author', owner.id);
		await installIdentity(author.id, blogId, 'author');

		const authorTree = await currentMembership(blogId, 'author');
		const commentTree = await currentMembership(blogId, 'comment');
		expect(authorTree.eligibleCount).toBe(2);
		expect(commentTree.eligibleCount).toBe(2);
	});

	it('puts a reviewer in the comment tree but NOT the author tree', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');

		const reviewer = await createUserWithEmail('r@x.com', 'reviewer');
		await setRole(blogId, reviewer.id, 'reviewer', owner.id);
		await installIdentity(reviewer.id, blogId, 'reviewer');

		const authorTree = await currentMembership(blogId, 'author');
		const commentTree = await currentMembership(blogId, 'comment');
		expect(authorTree.eligibleCount).toBe(1); // owner only — reviewer can't author
		expect(commentTree.eligibleCount).toBe(2);
	});

	it('adds a commenter only to the comment tree', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');

		const commenter = await createUserWithEmail('c@x.com', 'commenter');
		await setRole(blogId, commenter.id, 'commenter', owner.id);
		await installIdentity(commenter.id, blogId, 'commenter');

		expect((await currentMembership(blogId, 'author')).eligibleCount).toBe(1);
		expect((await currentMembership(blogId, 'comment')).eligibleCount).toBe(2);
	});
});

describe('removeMember', () => {
	it('soft-deletes a member and refreshes the snapshot back to the owner-only set', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');

		const author = await createUserWithEmail('a@x.com', 'author');
		await setRole(blogId, author.id, 'author', owner.id);
		await installIdentity(author.id, blogId, 'author');
		expect((await listMembers(blogId)).length).toBe(2);

		await removeMember(blogId, author.id);
		expect((await listMembers(blogId)).length).toBe(1);

		const current = await refreshSnapshot(blogId, 'author');
		expect(current.eligibleCount).toBe(1);
		const snap = await getSnapshotByRoot(blogId, 'author', current.root);
		expect(snap?.eligibleCount).toBe(1);
	});

	it('is idempotent on an already-removed member', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');
		const author = await createUserWithEmail('a@x.com', 'author');
		await setRole(blogId, author.id, 'author', owner.id);
		await installIdentity(author.id, blogId, 'author');
		await removeMember(blogId, author.id);
		await expect(removeMember(blogId, author.id)).resolves.not.toThrow();
	});
});

describe('isFirstOwner', () => {
	it('returns true for the original owner', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		expect(await isFirstOwner(blogId, owner.id)).toBe(true);
	});

	it('returns false for an owner added later', async () => {
		const o1 = await createUserWithEmail('o1@x.com', 'o1');
		const o2 = await createUserWithEmail('o2@x.com', 'o2');
		const { id: blogId } = await createBlog(o1.id, 'B', null);
		await setRole(blogId, o2.id, 'owner', o1.id);
		expect(await isFirstOwner(blogId, o2.id)).toBe(false);
		expect(await isFirstOwner(blogId, o1.id)).toBe(true);
	});
});

describe('refreshSnapshot (per capability)', () => {
	it('is idempotent: same identity set → no new row inserted for that tree', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');

		const r1 = await refreshSnapshot(blogId, 'author');
		const r2 = await refreshSnapshot(blogId, 'author');
		expect(r1.root).toBe(r2.root);
		expect(r2.changed).toBe(false);
	});

	it('inserts a new row for the author tree when the writers set changes', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner');
		const initial = await refreshSnapshot(blogId, 'author');

		const author = await createUserWithEmail('a@x.com', 'author');
		await setRole(blogId, author.id, 'author', owner.id);
		await installIdentity(author.id, blogId, 'author');

		const after = await refreshSnapshot(blogId, 'author');
		expect(after.root).not.toBe(initial.root);
		expect(after.eligibleCount).toBe(2);
	});

	it('a per-capability root is distinct per blog (per-blog commitments)', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: b1 } = await createBlog(owner.id, 'B1', null);
		const { id: b2 } = await createBlog(owner.id, 'B2', null);
		// The owner enrolls a DISTINCT commitment in each blog, so the author-tree
		// root differs across blogs even for a single-owner set. Within a blog the
		// author and comment trees still share the owner's single leaf → same root.
		await installIdentity(owner.id, b1, 'owner');
		await installIdentity(owner.id, b2, 'owner');
		const a1 = await refreshSnapshot(b1, 'author');
		const a2 = await refreshSnapshot(b2, 'author');
		const c1 = await refreshSnapshot(b1, 'comment');
		expect(a1.root).not.toBe(a2.root);
		expect(a1.root).toBe(c1.root);
		expect(await getSnapshotByRoot(b1, 'author', a1.root)).not.toBeNull();
		expect(await getSnapshotByRoot(b2, 'author', a1.root)).toBeNull();
		const fetched = await getSnapshotByRoot(b1, 'author', a1.root);
		expect(fetched?.capability).toBe('author');
	});
});

describe('refreshSnapshotsForUser (identity rotation)', () => {
	it('refreshes every tree of every blog the user belongs to', async () => {
		const u = await createUserWithEmail('u@x.com', 'u');
		const { id: b1 } = await createBlog(u.id, 'B1', null);
		const { id: b2 } = await createBlog(u.id, 'B2', null);
		await installIdentity(u.id, b1, 'u-v1');
		await installIdentity(u.id, b2, 'u-v1');

		await rotateIdentity(u.id, b1, 'u-v2');
		await rotateIdentity(u.id, b2, 'u-v2');
		await refreshSnapshotsForUser(u.id);

		for (const blogId of [b1, b2]) {
			const v2 = perBlogIdentity('u-v2', blogId).commitment.toString();
			for (const cap of ['author', 'comment'] as const) {
				const cur = await currentMembership(blogId, cap);
				expect(cur.identities).toContain(v2);
			}
		}
	});

	it('a commenter rotation refreshes the comment tree (they ARE in it now)', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const u = await createUserWithEmail('u@x.com', 'u');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await installIdentity(owner.id, blogId, 'owner-id');
		await setRole(blogId, u.id, 'commenter', owner.id);
		await installIdentity(u.id, blogId, 'u-v1');

		const beforeRoot = (await currentMembership(blogId, 'comment')).root;
		await rotateIdentity(u.id, blogId, 'u-v2');
		await refreshSnapshotsForUser(u.id);
		const afterRoot = (await currentMembership(blogId, 'comment')).root;
		expect(afterRoot).not.toBe(beforeRoot);
		const authorMembers = await currentMembership(blogId, 'author');
		expect(authorMembers.eligibleCount).toBe(1); // owner only
	});
});
