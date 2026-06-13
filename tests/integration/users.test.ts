import { describe, it, expect } from 'vitest';
import {
	getUserById,
	getUserByUsername,
	getUserByEmail,
	createUserWithEmail,
	updateUserProfile
} from '$lib/db/users';

describe('users.createUserWithEmail', () => {
	it('creates a user with username + email (email lowercased)', async () => {
		const u = await createUserWithEmail('Bob@Example.com', 'bob');
		expect(u.email).toBe('bob@example.com');
		expect(u.username).toBe('bob');
		expect((await getUserByEmail('BOB@example.com'))?.id).toBe(u.id);
		expect((await getUserByUsername('bob'))?.id).toBe(u.id);
		expect((await getUserById(u.id))?.id).toBe(u.id);
	});

	it('returns null on email/username miss', async () => {
		expect(await getUserByEmail('nobody@x')).toBeNull();
		expect(await getUserByUsername('nobody')).toBeNull();
	});

	it('rejects a duplicate username at the DB layer', async () => {
		await createUserWithEmail('a@x.com', 'shared');
		await expect(createUserWithEmail('b@x.com', 'shared')).rejects.toThrow();
	});

	it('rejects a duplicate email at the DB layer', async () => {
		await createUserWithEmail('dup@x.com', 'a');
		await expect(createUserWithEmail('dup@x.com', 'b')).rejects.toThrow();
	});
});

describe('users.updateUserProfile', () => {
	it('updates username and displayName', async () => {
		const u = await createUserWithEmail('u@x.com', 'old');
		const updated = await updateUserProfile(u.id, { username: 'new', displayName: 'New Display' });
		expect(updated?.username).toBe('new');
		expect(updated?.displayName).toBe('New Display');
	});

	it('no-op when patch is empty returns the current user', async () => {
		const u = await createUserWithEmail('u2@x.com', 'p');
		const back = await updateUserProfile(u.id, {});
		expect(back?.id).toBe(u.id);
	});

	it('returns null for unknown user id', async () => {
		const out = await updateUserProfile('00000000-0000-0000-0000-000000000000', {
			username: 'whatever'
		});
		expect(out).toBeNull();
	});
});
