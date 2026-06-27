// Unit tests for the audit helper's user-recording policy. No DB touch — we
// mock `$lib/db/client` so `audit()` records the values it WOULD insert into a
// captured array. The DB-backed end-to-end behaviour (real audit_log rows from
// the route handlers) is covered by tests/api/audit.test.ts.
//
// The privacy-critical guarantee under test: the four anonymous content actions
// pass `anonymous: true`, which must force actorUserId to null — overriding both
// an explicit actorUserId AND the locals.user fallback — while IP/UA are still
// captured. Every other event keeps recording the acting user as before.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const inserted: Array<Record<string, unknown>> = [];

vi.mock('$lib/db/client', () => ({
	db: {
		insert: () => ({
			values: async (row: Record<string, unknown>) => {
				inserted.push(row);
			}
		})
	},
	schema: { auditLog: {} as unknown }
}));
vi.mock('./log', () => ({
	log: {
		error: () => undefined,
		warn: () => undefined,
		info: () => undefined,
		debug: () => undefined
	}
}));

import { audit } from './audit';

// Minimal RequestEvent stand-in carrying a logged-in user + client metadata.
function fakeEvent(userId: string): RequestEvent {
	return {
		locals: { user: { id: userId } },
		getClientAddress: () => '203.0.113.7',
		request: { headers: { get: (k: string) => (k === 'user-agent' ? 'vitest-ua' : null) } }
	} as unknown as RequestEvent;
}

beforeEach(() => {
	inserted.length = 0;
});

describe('audit: anonymous content actions', () => {
	it('records NO actor for an anonymous event even with a logged-in user', async () => {
		await audit(fakeEvent('user-1'), {
			event: 'post.submitted',
			anonymous: true,
			subjectBlogId: 'blog-1',
			metadata: { post_id: 'p1' }
		});
		expect(inserted).toHaveLength(1);
		expect(inserted[0].actorUserId).toBeNull();
		// IP + UA are still captured for abuse investigation.
		expect(inserted[0].ip).toBe('203.0.113.7');
		expect(inserted[0].userAgent).toBe('vitest-ua');
		expect((inserted[0].metadata as Record<string, unknown>)?.post_id).toBe('p1');
	});

	it('anonymous overrides even an explicitly passed actorUserId', async () => {
		await audit(fakeEvent('user-1'), {
			event: 'review.cast',
			anonymous: true,
			actorUserId: 'user-1',
			subjectBlogId: 'blog-1'
		});
		expect(inserted[0].actorUserId).toBeNull();
		expect(inserted[0].ip).toBe('203.0.113.7');
	});

	// Phase 0 completion: the deciding-vote state-change events (the moment a
	// post crosses the publish / reject quorum) are anonymous too — recording the
	// reviewer who cast the deciding vote would de-anonymize that vote.
	it.each(['post.published', 'post.rejected'] as const)(
		'records NO actor for the deciding %s state-change',
		async (event) => {
			await audit(fakeEvent('decider-1'), {
				event,
				anonymous: true,
				subjectBlogId: 'blog-1',
				metadata: { post_id: 'p1' }
			});
			expect(inserted[0].actorUserId).toBeNull();
			expect(inserted[0].ip).toBe('203.0.113.7');
		}
	);
});

describe('audit: non-anonymous events still record the actor', () => {
	it('falls back to locals.user.id when no actorUserId is passed', async () => {
		await audit(fakeEvent('user-9'), {
			event: 'blog.member_added',
			subjectBlogId: 'blog-1',
			subjectUserId: 'target-1'
		});
		expect(inserted[0].actorUserId).toBe('user-9');
	});

	it('records an explicitly passed actorUserId', async () => {
		await audit(null, { event: 'session.destroyed', actorUserId: 'user-42' });
		expect(inserted[0].actorUserId).toBe('user-42');
	});
});
