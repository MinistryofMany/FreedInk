import { describe, it, expect } from 'vitest';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog, getBlogById } from '$lib/db/blogs';
import {
	listMembers,
	getActiveMember,
	setRole,
	removeMember,
	isFirstOwner
} from '$lib/db/members';
import {
	refreshSnapshot,
	getSnapshotByRoot,
	refreshSnapshotsForUser
} from '$lib/db/snapshots';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { Identity } from '@semaphore-protocol/identity';

async function installIdentity(userId: string, seed: string) {
	const id = new Identity(seed);
	await db.insert(schema.userIdentities).values({
		userId,
		idc: id.commitment.toString(),
		publicKey: id.publicKey.toString(),
		ciphertext: new Uint8Array([0]),
		kdfSalt: new Uint8Array(16),
		nonce: new Uint8Array(12),
		kdfParams: { name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' },
		status: 'active'
	});
	return id;
}

async function rotateIdentity(userId: string, seed: string) {
	const id = new Identity(seed);
	await db.transaction(async (tx) => {
		await tx
			.update(schema.userIdentities)
			.set({ status: 'revoked', revokedAt: new Date() })
			.where(
				and(eq(schema.userIdentities.userId, userId), eq(schema.userIdentities.status, 'active'))
			);
		await tx.insert(schema.userIdentities).values({
			userId,
			idc: id.commitment.toString(),
			publicKey: id.publicKey.toString(),
			ciphertext: new Uint8Array([0]),
			kdfSalt: new Uint8Array(16),
			nonce: new Uint8Array(12),
			kdfParams: { name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' },
			status: 'active'
		});
	});
	return id;
}

describe('createBlog', () => {
	it('inserts the blog, makes the creator the owner, and writes an initial snapshot', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner-id-seed');
		const { id, slug } = await createBlog(owner.id, 'My Blog', 'desc');
		expect(slug).toBe('my-blog');

		const blog = await getBlogById(id);
		expect(blog?.title).toBe('My Blog');

		const members = await listMembers(id);
		expect(members).toHaveLength(1);
		expect(members[0].role).toBe('owner');
		expect(members[0].user.id).toBe(owner.id);

		const snaps = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, id));
		expect(snaps).toHaveLength(1);
		expect(snaps[0].eligibleCount).toBe(1);
		expect(snaps[0].identities).toHaveLength(1);
	});
});

describe('setRole', () => {
	it('rotates a member from author to reviewer (single active row)', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const author = await createUserWithEmail('a@x.com', 'author');
		await installIdentity(author.id, 'author');

		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await setRole(blogId, author.id, 'author', owner.id);

		let active = await getActiveMember(blogId, author.id);
		expect(active?.role).toBe('author');

		await setRole(blogId, author.id, 'reviewer', owner.id);
		active = await getActiveMember(blogId, author.id);
		expect(active?.role).toBe('reviewer');

		// Old row should be soft-deleted (removedAt set), new row should be active.
		const allRows = await db
			.select()
			.from(schema.blogMembers)
			.where(and(eq(schema.blogMembers.blogId, blogId), eq(schema.blogMembers.userId, author.id)));
		expect(allRows).toHaveLength(2);
		expect(allRows.filter((r) => r.removedAt === null)).toHaveLength(1);
	});

	it('writes a fresh snapshot when adding a proving-eligible member', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		const before = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, blogId));

		const author = await createUserWithEmail('a@x.com', 'author');
		await installIdentity(author.id, 'author');
		await setRole(blogId, author.id, 'author', owner.id);

		const after = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, blogId));
		expect(after.length).toBeGreaterThan(before.length);
		const latest = after.at(-1)!;
		expect(latest.eligibleCount).toBe(2);
	});

	it('does NOT add a snapshot when changing a commenter (non-proving) role to commenter', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		const commenter = await createUserWithEmail('c@x.com', 'commenter');
		await installIdentity(commenter.id, 'commenter');
		await setRole(blogId, commenter.id, 'commenter', owner.id);

		const before = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, blogId));

		// Re-setting commenter→commenter via the same code path should not
		// produce a new snapshot since the proving set didn't change.
		await setRole(blogId, commenter.id, 'commenter', owner.id);

		const after = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, blogId));
		expect(after.length).toBe(before.length);
	});
});

describe('removeMember', () => {
	it('soft-deletes a member and refreshes the snapshot back to the owner-only set', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		const author = await createUserWithEmail('a@x.com', 'author');
		await installIdentity(author.id, 'author');
		await setRole(blogId, author.id, 'author', owner.id);
		expect((await listMembers(blogId)).length).toBe(2);

		await removeMember(blogId, author.id);
		expect((await listMembers(blogId)).length).toBe(1);

		// The current effective snapshot is the one that matches the present
		// member set, looked up via refreshSnapshot's returned root (it'll be
		// a no-op insert if the owner-only root was already seen).
		const current = await refreshSnapshot(blogId);
		expect(current.eligibleCount).toBe(1);
		const snap = await getSnapshotByRoot(blogId, current.root);
		expect(snap?.eligibleCount).toBe(1);
	});

	it('is idempotent on an already-removed member', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		const author = await createUserWithEmail('a@x.com', 'author');
		await installIdentity(author.id, 'author');
		await setRole(blogId, author.id, 'author', owner.id);
		await removeMember(blogId, author.id);
		await expect(removeMember(blogId, author.id)).resolves.not.toThrow();
	});
});

describe('isFirstOwner', () => {
	it('returns true for the original owner', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		expect(await isFirstOwner(blogId, owner.id)).toBe(true);
	});

	it('returns false for an owner added later', async () => {
		const o1 = await createUserWithEmail('o1@x.com', 'o1');
		await installIdentity(o1.id, 'o1');
		const o2 = await createUserWithEmail('o2@x.com', 'o2');
		await installIdentity(o2.id, 'o2');
		const { id: blogId } = await createBlog(o1.id, 'B', null);
		await setRole(blogId, o2.id, 'owner', o1.id);
		expect(await isFirstOwner(blogId, o2.id)).toBe(false);
		expect(await isFirstOwner(blogId, o1.id)).toBe(true);
	});
});

describe('refreshSnapshot', () => {
	it('is idempotent: same identity set → no new row inserted', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		const r1 = await refreshSnapshot(blogId);
		const r2 = await refreshSnapshot(blogId);
		expect(r1.root).toBe(r2.root);
		expect(r2.changed).toBe(false);

		const snaps = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, blogId));
		expect(snaps).toHaveLength(1);
	});

	it('inserts a new row when the proving set changes', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		const initial = await refreshSnapshot(blogId);

		const author = await createUserWithEmail('a@x.com', 'author');
		await installIdentity(author.id, 'author');
		await setRole(blogId, author.id, 'author', owner.id);

		const after = await refreshSnapshot(blogId);
		expect(after.root).not.toBe(initial.root);
		expect(after.eligibleCount).toBe(2);
	});

	it('stores per-blog snapshot rows even when two blogs share the same root', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner');
		const { id: b1 } = await createBlog(owner.id, 'B1', null);
		const { id: b2 } = await createBlog(owner.id, 'B2', null);
		const s1 = await refreshSnapshot(b1);
		const s2 = await refreshSnapshot(b2);
		// Identical proving set ({owner.idc}) → same root, but each blog has
		// its own row so the (blog_id, root) lookup must succeed for both.
		expect(s1.root).toBe(s2.root);
		expect(await getSnapshotByRoot(b1, s1.root)).not.toBeNull();
		expect(await getSnapshotByRoot(b2, s1.root)).not.toBeNull();
		// And different blogs may share a snapshot root without colliding.
		const rows1 = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, b1));
		const rows2 = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, b2));
		expect(rows1).toHaveLength(1);
		expect(rows2).toHaveLength(1);
	});
});

describe('refreshSnapshotsForUser (identity rotation)', () => {
	it('refreshes every blog the user belongs to as a proving member', async () => {
		const u = await createUserWithEmail('u@x.com', 'u');
		await installIdentity(u.id, 'u-v1');
		const { id: b1 } = await createBlog(u.id, 'B1', null);
		const { id: b2 } = await createBlog(u.id, 'B2', null);

		const before1 = (
			await db
				.select()
				.from(schema.blogMemberSnapshots)
				.where(eq(schema.blogMemberSnapshots.blogId, b1))
		).length;
		const before2 = (
			await db
				.select()
				.from(schema.blogMemberSnapshots)
				.where(eq(schema.blogMemberSnapshots.blogId, b2))
		).length;

		await rotateIdentity(u.id, 'u-v2');
		await refreshSnapshotsForUser(u.id);

		const after1 = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, b1));
		const after2 = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, b2));

		expect(after1.length).toBe(before1 + 1);
		expect(after2.length).toBe(before2 + 1);
		// The latest snapshot's identity list reflects the new IDC.
		const v2 = new Identity('u-v2').commitment.toString();
		expect(after1.at(-1)!.identities).toContain(v2);
		expect(after2.at(-1)!.identities).toContain(v2);
	});

	it('does not affect blogs the user is only a commenter on', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await installIdentity(owner.id, 'owner-id');
		const u = await createUserWithEmail('u@x.com', 'u');
		await installIdentity(u.id, 'u-v1');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		await setRole(blogId, u.id, 'commenter', owner.id);

		const before = (
			await db
				.select()
				.from(schema.blogMemberSnapshots)
				.where(eq(schema.blogMemberSnapshots.blogId, blogId))
		).length;

		await rotateIdentity(u.id, 'u-v2');
		await refreshSnapshotsForUser(u.id);

		const after = await db
			.select()
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.blogId, blogId));
		expect(after.length).toBe(before);
	});
});
