import { describe, it, expect, vi, beforeEach } from 'vitest';

// Verifies the OIDC callback consumes the pending `state` atomically: the
// handler now does a single DELETE ... RETURNING (gated on not-expired). If no
// row comes back (already consumed, expired, or never existed) it must reject
// with 400 *before* any code-for-token exchange. We drive that by controlling
// what the mocked delete().where().returning() yields.

// What the next delete().returning() call should resolve to.
let nextDeleteResult: unknown[] = [];
// Records the WHERE arg passed to the delete chain so we can assert the
// consume keys on `state` (single-use), not a blind delete-all.
const deleteWhereArgs: unknown[] = [];

function deleteChain() {
	const chain = {
		where: (cond: unknown) => {
			deleteWhereArgs.push(cond);
			return chain;
		},
		returning: async () => nextDeleteResult
	};
	return chain;
}

vi.mock('$lib/db/client', async () => {
	const realSchema = await import('$lib/db/schema');
	const db = {
		delete: () => deleteChain(),
		// hasNoActiveIdentity() runs only on the success path; return "has an
		// identity" so the happy path redirects to /admin without extra setup.
		select: () => {
			const chain = {
				from: () => chain,
				where: () => chain,
				limit: async () => [{ id: 'identity-1' }]
			};
			return chain;
		}
	};
	return { db, schema: realSchema };
});

const exchangeCodeForClaims = vi.fn(async () => ({ sub: 'sub-1', name: 'Alice' }));

vi.mock('$lib/server/oidc', () => ({
	oidcConfig: () => ({ issuer: 'https://ministry.id', clientId: 'freedink' }),
	exchangeCodeForClaims,
	extractAnonEpoch: () => null,
	issuerKey: () => 'https://ministry.id',
	safeNext: (raw: string | null | undefined) => (raw ? raw : null),
	NEXT_COOKIE: 'oidc_next'
}));

vi.mock('$lib/db/oidc', () => ({
	getUserByOidcIdentity: vi.fn(async () => ({ id: 'user-1' })),
	createUserWithOidcIdentity: vi.fn(async () => ({ id: 'user-1' })),
	linkOidcIdentityToUser: vi.fn(async () => {}),
	setUserAnonEpoch: vi.fn(async () => {})
}));

vi.mock('$lib/server/session', () => ({
	createSession: vi.fn(async () => 'session-1'),
	setSessionCookie: vi.fn(() => {}),
	SuspendedUserError: class SuspendedUserError extends Error {}
}));

vi.mock('$lib/server/rate-limit', () => ({
	enforce: vi.fn(async () => {}),
	RULES: { authFinish: { name: 'authFinish' } }
}));

vi.mock('$lib/server/audit', () => ({
	audit: vi.fn(async () => {})
}));

const { GET } = await import('./+server');

type EventArg = Parameters<typeof GET>[0];

function makeEvent(search: Record<string, string>): EventArg {
	const url = new URL('https://freed.ink/api/auth/oidc/callback');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		cookies: { get: () => undefined, delete: () => {} },
		locals: { user: null },
		request: { headers: { get: () => null } },
		getClientAddress: () => '127.0.0.1'
	} as unknown as EventArg;
}

beforeEach(() => {
	nextDeleteResult = [];
	deleteWhereArgs.length = 0;
	exchangeCodeForClaims.mockClear();
});

describe('oidc callback atomic state consume', () => {
	it('rejects with 400 when the state row is already consumed/expired', async () => {
		nextDeleteResult = []; // DELETE ... RETURNING matched no row.
		await expect(GET(makeEvent({ code: 'abc', state: 'st-1' }))).rejects.toMatchObject({
			status: 400
		});
		// The unverified code must never reach the token endpoint.
		expect(exchangeCodeForClaims).not.toHaveBeenCalled();
		// The consume was attempted (keyed on state), not skipped.
		expect(deleteWhereArgs).toHaveLength(1);
	});

	it('proceeds to the token exchange when the consume returns a row', async () => {
		nextDeleteResult = [
			{ state: 'st-1', nonce: 'n-1', codeVerifier: 'cv-1', expiresAt: new Date() }
		];
		// Success path ends in a 303 redirect (thrown by SvelteKit).
		await expect(GET(makeEvent({ code: 'abc', state: 'st-1' }))).rejects.toMatchObject({
			status: 303
		});
		expect(exchangeCodeForClaims).toHaveBeenCalledTimes(1);
		// Verifier + nonce from the consumed row feed the exchange.
		expect(exchangeCodeForClaims).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ codeVerifier: 'cv-1', expectedNonce: 'n-1' })
		);
	});

	it('rejects with 400 when code or state is missing (no consume attempted)', async () => {
		await expect(GET(makeEvent({ code: 'abc' }))).rejects.toMatchObject({ status: 400 });
		expect(deleteWhereArgs).toHaveLength(0);
		expect(exchangeCodeForClaims).not.toHaveBeenCalled();
	});
});
