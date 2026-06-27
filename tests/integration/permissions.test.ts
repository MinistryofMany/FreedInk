// Phase 6 — permissions dashboard data layer. Verifies changeCapabilities:
//   - applies a capability diff and refreshes the right tree;
//   - writes the member-visible permission_changes row (attributed, NO IP/UA);
//   - enforces the last-admin guard;
//   - listPermissionChanges returns only safe fields with resolved usernames.
import { describe, it, expect } from 'vitest';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';
import {
	setRole,
	changeCapabilities,
	listPermissionChanges,
	getActiveMember,
	countAdmins
} from '$lib/db/members';
import { currentMembership } from '$lib/db/snapshots';
import { db, schema } from '$lib/db/client';
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
}

describe('changeCapabilities', () => {
	it('grants a capability, refreshes the tree, and writes an attributed log row', async () => {
		const owner = await createUserWithEmail('pc-o@x.com', 'pc-owner');
		await installIdentity(owner.id, 'pc-owner');
		const target = await createUserWithEmail('pc-t@x.com', 'pc-target');
		await installIdentity(target.id, 'pc-target');
		const { id: blogId } = await createBlog(owner.id, 'PC', null);
		await setRole(blogId, target.id, 'commenter', owner.id);

		// Commenter is not in the author tree yet.
		expect((await currentMembership(blogId, 'author')).eligibleCount).toBe(1);

		const { before, after } = await changeCapabilities({
			blogId,
			targetUserId: target.id,
			actorUserId: owner.id,
			patch: { author: true }
		});
		expect(before.canAuthor).toBe(false);
		expect(after.canAuthor).toBe(true);

		// The grant landed on the row AND the author tree grew.
		const m = await getActiveMember(blogId, target.id);
		expect(m?.canAuthor).toBe(true);
		expect((await currentMembership(blogId, 'author')).eligibleCount).toBe(2);

		// A member-visible permission_changes row was written, attributed, with the
		// before/after caps and NO IP/UA columns (the table has none).
		const changes = await listPermissionChanges(blogId);
		expect(changes).toHaveLength(1);
		expect(changes[0].actor).toBe('pc-owner');
		expect(changes[0].subject).toBe('pc-target');
		expect(changes[0].oldCaps.canAuthor).toBe(false);
		expect(changes[0].newCaps.canAuthor).toBe(true);
		// Hard guarantee: the table cannot leak IP/UA — assert the columns are absent.
		const raw = await db.select().from(schema.permissionChanges);
		expect(raw[0]).not.toHaveProperty('ip');
		expect(raw[0]).not.toHaveProperty('userAgent');
		expect(raw[0]).not.toHaveProperty('user_agent');
	});

	it('blocks removing can_admin from the last admin (last-admin guard)', async () => {
		const owner = await createUserWithEmail('la-o@x.com', 'la-owner');
		await installIdentity(owner.id, 'la-owner');
		const { id: blogId } = await createBlog(owner.id, 'LA', null);
		// The owner is the only admin.
		expect(await countAdmins(blogId)).toBe(1);

		await expect(
			changeCapabilities({
				blogId,
				targetUserId: owner.id,
				actorUserId: owner.id,
				patch: { admin: false }
			})
		).rejects.toMatchObject({ status: 409 });
		// Still an admin; no log row written.
		expect(await countAdmins(blogId)).toBe(1);
		expect(await listPermissionChanges(blogId)).toHaveLength(0);
	});

	it('allows demoting an admin when another admin remains', async () => {
		const owner = await createUserWithEmail('2a-o@x.com', '2a-owner');
		await installIdentity(owner.id, '2a-owner');
		const second = await createUserWithEmail('2a-s@x.com', '2a-second');
		await installIdentity(second.id, '2a-second');
		const { id: blogId } = await createBlog(owner.id, '2A', null);
		await setRole(blogId, second.id, 'owner', owner.id); // second is now admin
		expect(await countAdmins(blogId)).toBe(2);

		// Demote the second admin — allowed (one admin remains).
		const { after } = await changeCapabilities({
			blogId,
			targetUserId: second.id,
			actorUserId: owner.id,
			patch: { admin: false }
		});
		expect(after.canAdmin).toBe(false);
		expect(await countAdmins(blogId)).toBe(1);
	});
});
