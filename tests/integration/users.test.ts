import { describe, it, expect } from 'vitest';
import {
	getUserById,
	getUserByUsername,
	getUserByEmail,
	getUserByWalletAddress,
	createUserWithWallet,
	createUserWithEmail,
	linkWalletToUser,
	updateUserProfile,
	markEmailVerified,
	getUserWallets,
	getUserPasskeys
} from '$lib/db/users';

const ADDR = '0x' + '11'.repeat(20);
const ADDR2 = '0x' + '22'.repeat(20);

describe('users.createUserWithWallet', () => {
	it('creates a user and links the wallet address (normalized to lowercase)', async () => {
		const u = await createUserWithWallet(ADDR.toUpperCase());
		expect(u.id).toBeTruthy();
		expect(u.username).toMatch(/^0x/);
		const wallets = await getUserWallets(u.id);
		expect(wallets).toHaveLength(1);
		expect(wallets[0].address).toBe(ADDR.toLowerCase());
	});

	it('finds the same user by wallet address regardless of input casing', async () => {
		const u = await createUserWithWallet(ADDR);
		expect((await getUserByWalletAddress(ADDR))?.id).toBe(u.id);
		expect((await getUserByWalletAddress(ADDR.toUpperCase()))?.id).toBe(u.id);
	});

	it('returns null for an unknown wallet', async () => {
		expect(await getUserByWalletAddress(ADDR)).toBeNull();
	});
});

describe('users.createUserWithEmail', () => {
	it('creates a user with username + email (email lowercased)', async () => {
		const u = await createUserWithEmail('Bob@Example.com', 'bob');
		expect(u.email).toBe('bob@example.com');
		expect(u.username).toBe('bob');
		expect((await getUserByEmail('BOB@example.com'))?.id).toBe(u.id);
		expect((await getUserByUsername('bob'))?.id).toBe(u.id);
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

describe('users.linkWalletToUser', () => {
	it('links a wallet to an existing user', async () => {
		const u = await createUserWithEmail('w@x.com', 'walletuser');
		await linkWalletToUser(u.id, ADDR);
		const wallets = await getUserWallets(u.id);
		expect(wallets).toHaveLength(1);
		expect(wallets[0].address).toBe(ADDR.toLowerCase());
	});

	it('is idempotent on duplicate (address, user_id)', async () => {
		const u = await createUserWithEmail('w2@x.com', 'walletuser2');
		await linkWalletToUser(u.id, ADDR);
		await linkWalletToUser(u.id, ADDR); // no-op via ON CONFLICT
		expect(await getUserWallets(u.id)).toHaveLength(1);
	});

	it('cannot link the same wallet to two different users', async () => {
		const a = await createUserWithEmail('a@x.com', 'a');
		const b = await createUserWithEmail('b@x.com', 'b');
		await linkWalletToUser(a.id, ADDR);
		// The second call hits ON CONFLICT (address) and silently no-ops; the
		// row stays attached to user A. Verify by lookup.
		await linkWalletToUser(b.id, ADDR);
		expect((await getUserByWalletAddress(ADDR))?.id).toBe(a.id);
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

describe('users.markEmailVerified', () => {
	it('stamps emailVerifiedAt', async () => {
		const u = await createUserWithEmail('verify@x.com', 'v');
		await markEmailVerified(u.id);
		const back = await getUserById(u.id);
		expect(back?.emailVerifiedAt).toBeInstanceOf(Date);
	});
});

describe('users.getUserPasskeys', () => {
	it('returns an empty list for a user with no passkeys', async () => {
		const u = await createUserWithEmail('np@x.com', 'np');
		expect(await getUserPasskeys(u.id)).toEqual([]);
	});
});
