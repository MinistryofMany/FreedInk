import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the row handed to db.insert(...).values(...) so we can assert the
// identity POST/rotate handlers write kdf = 'pbkdf2-sha256' explicitly rather
// than relying on the column default.
const insertedValues: Record<string, unknown>[] = [];

// Minimal chainable stubs mirroring the drizzle call shapes the handlers use:
//   db.select({...}).from(...).where(...).limit(1)         -> []
//   db.insert(table).values(row)                           -> resolves
//   db.transaction(cb)                                     -> runs cb with a tx
//   tx.update(...).set(...).where(...).returning(...)      -> []
function selectChain() {
	const chain = {
		from: () => chain,
		where: () => chain,
		limit: async () => [] as unknown[]
	};
	return chain;
}

function insertChain() {
	return {
		values: async (row: Record<string, unknown>) => {
			insertedValues.push(row);
		}
	};
}

function updateChain() {
	const chain = {
		set: () => chain,
		where: () => chain,
		returning: async () => [] as unknown[]
	};
	return chain;
}

const fakeTx = {
	update: () => updateChain(),
	insert: () => insertChain()
};

vi.mock('$lib/db/client', async () => {
	const realSchema = await import('$lib/db/schema');
	const db = {
		select: () => selectChain(),
		insert: () => insertChain(),
		transaction: async (cb: (tx: typeof fakeTx) => Promise<void>) => cb(fakeTx)
	};
	return { db, schema: realSchema };
});

vi.mock('$lib/db/snapshots', () => ({
	refreshSnapshotsForUser: vi.fn(async () => {})
}));

vi.mock('$lib/server/audit', () => ({
	audit: vi.fn(async () => {})
}));

// session.ts is only used by the rotate handler; stub its session lifecycle so
// the handler runs without a real session store.
vi.mock('$lib/server/session', () => ({
	createSession: vi.fn(async () => 'new-session-id'),
	destroySession: vi.fn(async () => {}),
	revokeAllSessions: vi.fn(async () => {}),
	setSessionCookie: vi.fn(() => {}),
	SESSION_COOKIE_NAME: 'fink_session'
}));

vi.mock('$lib/server/rate-limit', () => ({
	enforce: vi.fn(async () => {}),
	RULES: { identityRotate: { name: 'identityRotate' }, authFinish: { name: 'authFinish' } }
}));

const { POST: postCreate } = await import('./+server');
const { POST: postRotate } = await import('./rotate/+server');

// A well-formed encrypted-identity blob. The handler's Zod schema pins
// kdf to the literal 'pbkdf2-sha256'.
function validBlob() {
	return {
		idc: '12345678901234567890',
		public_key: 'cGsta2V5',
		ciphertext: 'Y2lwaGVydGV4dA',
		salt: 'c2FsdHNhbHQ',
		nonce: 'bm9uY2Vub25jZQ',
		kdf: 'pbkdf2-sha256',
		kdf_params: { name: 'PBKDF2', iterations: 200000, hash: 'SHA-256' }
	};
}

// Minimal RequestEvent stand-in: the handlers only touch request.json,
// request.headers.get, locals.user, cookies.get, and getClientAddress. The
// create and rotate handlers carry different route-id-parametrized event
// types, so we intersect both to feed the same stub to either.
type IdentityEvent = Parameters<typeof postCreate>[0] & Parameters<typeof postRotate>[0];
function makeEvent(body: unknown): IdentityEvent {
	return {
		request: { json: async () => body, headers: { get: () => null } },
		locals: { user: { id: 'user-1' } },
		cookies: { get: () => undefined },
		getClientAddress: () => '127.0.0.1'
	} as unknown as IdentityEvent;
}

beforeEach(() => {
	insertedValues.length = 0;
});

describe('identity POST (create) kdf write', () => {
	it('writes kdf = pbkdf2-sha256 explicitly on insert', async () => {
		await postCreate(makeEvent(validBlob()));
		expect(insertedValues).toHaveLength(1);
		expect(insertedValues[0]?.kdf).toBe('pbkdf2-sha256');
	});

	it('rejects a blob whose kdf is not pbkdf2-sha256 (422)', async () => {
		const bad = { ...validBlob(), kdf: 'scrypt' };
		await expect(postCreate(makeEvent(bad))).rejects.toMatchObject({ status: 422 });
		expect(insertedValues).toHaveLength(0);
	});
});

describe('identity rotate kdf write', () => {
	it('writes kdf = pbkdf2-sha256 explicitly on the new identity insert', async () => {
		await postRotate(makeEvent(validBlob()));
		expect(insertedValues).toHaveLength(1);
		expect(insertedValues[0]?.kdf).toBe('pbkdf2-sha256');
	});
});
