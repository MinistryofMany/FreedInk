// Authorization unit tests for the platform-operator form actions.
//
// SvelteKit form actions do NOT run the parent +layout.server.ts load, so each
// action in users/+page.server.ts and flags/+page.server.ts must re-check
// isPlatformOperator itself. These tests prove the negative path: a signed-in
// non-operator is rejected with 403 and mutates nothing (no DB write, no
// session revocation, no flag change, no audit row). They also confirm an
// operator proceeds to the underlying mutation.
//
// Pure unit test: every DB / session / audit / flag dependency is mocked, so
// nothing here touches postgres or the dev server. The DB-backed end-to-end
// behaviour is exercised by the api suite.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// All spies live in a hoisted block so the vi.mock factories (which vitest
// hoists above normal top-level code) can close over them without tripping the
// "cannot access before initialization" guard.
const spies = vi.hoisted(() => ({
	isPlatformOperator: vi.fn<(user: unknown) => boolean>(),
	dbUpdate: vi.fn(),
	selectLimit: vi.fn<() => Promise<Array<{ id: string }>>>(),
	revokeAllSessions: vi.fn<(...args: unknown[]) => Promise<number>>(),
	audit: vi.fn<(...args: unknown[]) => Promise<void>>(),
	createFlag: vi.fn<(...args: unknown[]) => Promise<void>>(),
	setFlag: vi.fn<(...args: unknown[]) => Promise<{ key: string }>>(),
	setOverride: vi.fn<(...args: unknown[]) => Promise<void>>(),
	removeOverride: vi.fn<(...args: unknown[]) => Promise<void>>()
}));

// fail() must produce a recognizable { status, data } shape the assertions read
// without pulling in the SvelteKit runtime under the unit project.
vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data?: Record<string, unknown>) => ({
		status,
		data: data ?? {},
		__failure: true
	})
}));

// isPlatformOperator is the gate under test. We flip it per-test via the spy.
vi.mock('$lib/server/operators', () => ({
	isPlatformOperator: (user: unknown) => spies.isPlatformOperator(user)
}));

// DB: only the suspend action reads it (existence check + update). We give it a
// chainable query builder so the action runs, and spy on the mutating call.
vi.mock('$lib/db/client', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: spies.selectLimit
				})
			})
		}),
		update: (...args: unknown[]) => {
			spies.dbUpdate(...args);
			return {
				set: () => ({
					where: async () => undefined
				})
			};
		}
	},
	schema: {
		users: { id: 'users.id' }
	}
}));

vi.mock('$lib/server/session', () => ({
	revokeAllSessions: (...args: unknown[]) => spies.revokeAllSessions(...args)
}));

vi.mock('$lib/server/audit', () => ({
	audit: (...args: unknown[]) => spies.audit(...args)
}));

// Flag mutators: the flags actions call into these. Spying lets us assert no
// flag is created/updated/overridden when the gate rejects.
vi.mock('$lib/server/flags', () => ({
	createFlag: (...a: unknown[]) => spies.createFlag(...a),
	setFlag: (...a: unknown[]) => spies.setFlag(...a),
	setOverride: (...a: unknown[]) => spies.setOverride(...a),
	removeOverride: (...a: unknown[]) => spies.removeOverride(...a),
	listFlags: async () => [],
	listOverridesForUser: async () => [],
	isValidFlagKey: () => true
}));

const {
	isPlatformOperator,
	dbUpdate,
	selectLimit,
	revokeAllSessions,
	audit,
	createFlag,
	setFlag,
	setOverride,
	removeOverride
} = spies;

import { actions as userActions } from './users/+page.server';
import { actions as flagActions } from './flags/+page.server';

const OPERATOR_ID = '11111111-1111-1111-1111-111111111111';
const TARGET_ID = '22222222-2222-2222-2222-222222222222';

type ActionFailure = { status: number; data: Record<string, unknown>; __failure?: true };

function isFailure(v: unknown): v is ActionFailure {
	return typeof v === 'object' && v !== null && '__failure' in v;
}

// The flag and user actions are each typed for their own route id; the mock
// only ever reads locals.user and request.formData(), so type it as the
// intersection of both action params - a value of that type is assignable to
// either action signature.
type PlatformActionEvent = Parameters<(typeof flagActions)['createFlag']>[0] &
	Parameters<(typeof userActions)['suspend']>[0];

// Minimal RequestEvent stand-in: the actions only read locals.user and
// request.formData(); audit() (mocked) would read the rest.
function makeEvent(user: { id: string; username: string } | null, form: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) fd.set(k, v);
	return {
		locals: { user },
		request: { formData: async () => fd },
		getClientAddress: () => '127.0.0.1'
	} as unknown as PlatformActionEvent;
}

const NON_OPERATOR = { id: 'deadbeef', username: 'regular' };
const OPERATOR = { id: OPERATOR_ID, username: 'platform-op' };

beforeEach(() => {
	vi.clearAllMocks();
	selectLimit.mockResolvedValue([{ id: TARGET_ID }]);
	revokeAllSessions.mockResolvedValue(0);
	// saveFlag treats a falsy return as "flag not found" (404); give the spy a
	// truthy row so the operator path reaches success.
	setFlag.mockResolvedValue({ key: 'feature.x' });
	createFlag.mockResolvedValue(undefined);
	setOverride.mockResolvedValue(undefined);
	removeOverride.mockResolvedValue(undefined);
	audit.mockResolvedValue(undefined);
});

// Every action, the form body it expects when valid, and the spies that must
// stay untouched on the rejected (non-operator) path.
const flagCases: Array<{
	name: string;
	run: (event: ReturnType<typeof makeEvent>) => unknown;
	form: Record<string, string>;
	mutators: ReturnType<typeof vi.fn>[];
}> = [
	{
		name: 'createFlag',
		run: (e) => flagActions.createFlag(e),
		form: { key: 'feature.x', description: 'd' },
		mutators: [createFlag]
	},
	{
		name: 'saveFlag',
		run: (e) => flagActions.saveFlag(e),
		form: { key: 'feature.x', enabled: 'true', rollout_percentage: '50' },
		mutators: [setFlag]
	},
	{
		name: 'setOverride',
		run: (e) => flagActions.setOverride(e),
		form: { flag_key: 'feature.x', user_query: 'someuser', enabled: 'true' },
		mutators: [setOverride]
	},
	{
		name: 'removeOverride',
		run: (e) => flagActions.removeOverride(e),
		form: { flag_key: 'feature.x', user_id: TARGET_ID },
		mutators: [removeOverride]
	}
];

describe('platform flag actions: operator gate', () => {
	it.each(flagCases)('$name rejects a non-operator with 403 and mutates nothing', async (c) => {
		isPlatformOperator.mockReturnValue(false);
		const result = await c.run(makeEvent(NON_OPERATOR, c.form));

		expect(isFailure(result)).toBe(true);
		expect((result as ActionFailure).status).toBe(403);
		for (const m of c.mutators) expect(m).not.toHaveBeenCalled();
		expect(audit).not.toHaveBeenCalled();
	});

	it.each(flagCases)('$name lets an operator through to the mutation', async (c) => {
		isPlatformOperator.mockReturnValue(true);
		const result = await c.run(makeEvent(OPERATOR, c.form));

		// Operator path succeeds (no ActionFailure) and the underlying mutator ran.
		expect(isFailure(result)).toBe(false);
		for (const m of c.mutators) expect(m).toHaveBeenCalledTimes(1);
	});
});

describe('platform users suspend action: operator gate', () => {
	it('rejects a non-operator with 403 and mutates nothing', async () => {
		isPlatformOperator.mockReturnValue(false);
		const result = await userActions.suspend(makeEvent(NON_OPERATOR, { user_id: TARGET_ID }));

		expect(isFailure(result)).toBe(true);
		expect((result as ActionFailure).status).toBe(403);
		expect(dbUpdate).not.toHaveBeenCalled();
		expect(revokeAllSessions).not.toHaveBeenCalled();
		expect(audit).not.toHaveBeenCalled();
	});

	it('suspends the user for an operator: sets suspended_at, revokes sessions, audits', async () => {
		isPlatformOperator.mockReturnValue(true);
		revokeAllSessions.mockResolvedValue(3);
		const result = await userActions.suspend(
			makeEvent(OPERATOR, { user_id: TARGET_ID, reason: 'spam' })
		);

		expect(isFailure(result)).toBe(false);
		expect(result).toMatchObject({ ok: true, revoked: 3 });
		expect(dbUpdate).toHaveBeenCalledTimes(1);
		expect(revokeAllSessions).toHaveBeenCalledWith(TARGET_ID);
		expect(audit).toHaveBeenCalledTimes(1);
		const auditArg = audit.mock.calls[0]?.[1] as {
			event: string;
			subjectUserId: string;
			metadata: { reason: string | null; sessions_revoked: number };
		};
		expect(auditArg.event).toBe('user.suspended');
		expect(auditArg.subjectUserId).toBe(TARGET_ID);
		expect(auditArg.metadata).toMatchObject({ reason: 'spam', sessions_revoked: 3 });
	});

	it('refuses self-suspension (409) and mutates nothing', async () => {
		isPlatformOperator.mockReturnValue(true);
		const result = await userActions.suspend(makeEvent(OPERATOR, { user_id: OPERATOR_ID }));

		expect(isFailure(result)).toBe(true);
		expect((result as ActionFailure).status).toBe(409);
		expect(dbUpdate).not.toHaveBeenCalled();
		expect(revokeAllSessions).not.toHaveBeenCalled();
		expect(audit).not.toHaveBeenCalled();
	});

	it('returns 404 for an unknown target and mutates nothing', async () => {
		isPlatformOperator.mockReturnValue(true);
		selectLimit.mockResolvedValue([]);
		const result = await userActions.suspend(makeEvent(OPERATOR, { user_id: TARGET_ID }));

		expect(isFailure(result)).toBe(true);
		expect((result as ActionFailure).status).toBe(404);
		expect(dbUpdate).not.toHaveBeenCalled();
		expect(revokeAllSessions).not.toHaveBeenCalled();
		expect(audit).not.toHaveBeenCalled();
	});

	it('rejects a malformed user_id (422) before any mutation', async () => {
		isPlatformOperator.mockReturnValue(true);
		const result = await userActions.suspend(makeEvent(OPERATOR, { user_id: 'not-a-uuid' }));

		expect(isFailure(result)).toBe(true);
		expect((result as ActionFailure).status).toBe(422);
		expect(dbUpdate).not.toHaveBeenCalled();
		expect(revokeAllSessions).not.toHaveBeenCalled();
	});
});
