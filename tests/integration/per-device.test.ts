// Phase 3 — per-device identity commitments + revocation. Verifies:
//   1. A multi-device member contributes ALL their active commitments to a tree
//      (so they are provable from either device).
//   2. Leaf ordering is deterministic over commitments (D9) and per-user-local.
//   3. Revoking one device drops exactly that leaf; the other device still works.
//   4. A revoked device's commitment is no longer in the current root (its
//      in-flight proofs fail requireCurrentRoot — covered at the verify level in
//      semaphore.test.ts; here we assert membership/root behaviour).
import { describe, it, expect } from 'vitest';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';
import { setRole } from '$lib/db/members';
import { currentMembership, refreshSnapshotsForUser } from '$lib/db/snapshots';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { Identity } from '@semaphore-protocol/identity';

async function installDevice(userId: string, seed: string, opts: { label?: string } = {}) {
	const id = new Identity(seed);
	await db.insert(schema.userIdentities).values({
		userId,
		idc: id.commitment.toString(),
		publicKey: id.publicKey.toString(),
		ciphertext: new Uint8Array([0]),
		kdfSalt: new Uint8Array(16),
		nonce: new Uint8Array(12),
		kdfParams: { name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' },
		deviceLabel: opts.label ?? null,
		status: 'active'
	});
	return id;
}

async function revokeDevice(userId: string, idc: string) {
	await db
		.update(schema.userIdentities)
		.set({ status: 'revoked', revokedAt: new Date() })
		.where(and(eq(schema.userIdentities.userId, userId), eq(schema.userIdentities.idc, idc)));
	await refreshSnapshotsForUser(userId);
}

describe('multi-device membership', () => {
	it('includes every active commitment of a member in their tree', async () => {
		const owner = await createUserWithEmail('md-o@x.com', 'md-owner');
		const dev1 = await installDevice(owner.id, 'md-owner-laptop', { label: 'laptop' });
		const { id: blogId } = await createBlog(owner.id, 'MD', null);
		// Enroll a second device for the owner and refresh.
		const dev2 = await installDevice(owner.id, 'md-owner-phone', { label: 'phone' });
		await refreshSnapshotsForUser(owner.id);

		const authorTree = await currentMembership(blogId, 'author');
		// BOTH commitments are leaves → the owner is provable from either device.
		expect(authorTree.eligibleCount).toBe(2);
		expect(authorTree.identities).toContain(dev1.commitment.toString());
		expect(authorTree.identities).toContain(dev2.commitment.toString());
	});

	it('orders leaves deterministically and keeps a member’s devices contiguous', async () => {
		// Two members, each with two devices. Leaves must be grouped by member
		// (userCreatedAt, userId) then by device — i.e. a member's devices are
		// contiguous, and the order is a pure function of stored fields.
		const owner = await createUserWithEmail('ord-o@x.com', 'ord-owner');
		await installDevice(owner.id, 'ord-owner-a');
		const { id: blogId } = await createBlog(owner.id, 'ORD', null);
		await installDevice(owner.id, 'ord-owner-b');

		const author = await createUserWithEmail('ord-a@x.com', 'ord-author');
		await installDevice(author.id, 'ord-author-a');
		await setRole(blogId, author.id, 'author', owner.id);
		await installDevice(author.id, 'ord-author-b');
		await refreshSnapshotsForUser(author.id);

		const t1 = await currentMembership(blogId, 'author');
		const t2 = await currentMembership(blogId, 'author');
		// Deterministic: two derivations give the identical ordered list + root.
		expect(t1.identities).toEqual(t2.identities);
		expect(t1.root).toBe(t2.root);
		expect(t1.eligibleCount).toBe(4);

		// Owner (created first) owns the first two leaves; author the last two.
		const ownerIdcs = (
			await db
				.select({ idc: schema.userIdentities.idc })
				.from(schema.userIdentities)
				.where(eq(schema.userIdentities.userId, owner.id))
		).map((r) => r.idc);
		const first2 = t1.identities.slice(0, 2);
		expect(first2.every((idc) => ownerIdcs.includes(idc))).toBe(true);
	});
});

describe('device revocation', () => {
	it('drops exactly the revoked leaf and keeps the other device provable', async () => {
		const owner = await createUserWithEmail('rev-o@x.com', 'rev-owner');
		await installDevice(owner.id, 'rev-owner-main');
		const { id: blogId } = await createBlog(owner.id, 'REV', null);
		const phone = await installDevice(owner.id, 'rev-owner-phone');
		await refreshSnapshotsForUser(owner.id);

		let tree = await currentMembership(blogId, 'author');
		expect(tree.eligibleCount).toBe(2);
		expect(tree.identities).toContain(phone.commitment.toString());

		// Revoke the phone.
		await revokeDevice(owner.id, phone.commitment.toString());

		tree = await currentMembership(blogId, 'author');
		// The phone leaf is gone; the main device remains.
		expect(tree.eligibleCount).toBe(1);
		expect(tree.identities).not.toContain(phone.commitment.toString());
	});

	it('a revoked commitment is absent from the new current root (fail-closed)', async () => {
		const owner = await createUserWithEmail('fc-o@x.com', 'fc-owner');
		await installDevice(owner.id, 'fc-owner-main');
		const { id: blogId } = await createBlog(owner.id, 'FC', null);
		const phone = await installDevice(owner.id, 'fc-owner-phone');
		await refreshSnapshotsForUser(owner.id);

		const rootBefore = (await currentMembership(blogId, 'author')).root;
		await revokeDevice(owner.id, phone.commitment.toString());
		const rootAfter = (await currentMembership(blogId, 'author')).root;
		// The root advanced (the revoked device's leaf left), so any proof built
		// against rootBefore by the revoked device fails requireCurrentRoot.
		expect(rootAfter).not.toBe(rootBefore);
		expect((await currentMembership(blogId, 'author')).identities).not.toContain(
			phone.commitment.toString()
		);
	});
});
