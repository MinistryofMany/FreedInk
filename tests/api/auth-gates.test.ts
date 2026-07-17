import { describe, it, expect } from 'vitest';
import { postJSON } from './helpers';

const stubProof = {
	merkleTreeDepth: 1,
	merkleTreeRoot: '0',
	nullifier: '0',
	message: '0',
	scope: '0',
	points: []
};

describe('auth gates: unauthenticated requests are rejected', () => {
	// NOTE: /api/blog/post, /api/blog/post/edit, /api/post/comment AND
	// /api/post/review are NO LONGER here — Phases 4–5 made them session-free
	// (post/edit/comment authorized by a Semaphore proof; review by a blind
	// token). They are covered by the session-free describe below. The vote-token
	// ISSUANCE endpoint stays session-authed (it is the only step that reveals
	// participation) → 401 unauthenticated.
	it.each([
		['/api/blog/create', { title: 't', description: 'd' }],
		['/api/blog/group', { blog_slug: 'x', capability: 'author' }],
		[
			'/api/blog/members',
			{ blog_id: '00000000-0000-0000-0000-000000000000', target: { username: 'x' }, role: 'author' }
		],
		['/api/blog/archive', { blog_id: '00000000-0000-0000-0000-000000000000', archive: true }],
		[
			'/api/blog/vote-token',
			{ post_version_id: '00000000-0000-0000-0000-000000000000', blinded_message: 'AA' }
		],
		['/api/post/submit', { post_version_id: '00000000-0000-0000-0000-000000000000' }],
		['/api/post/tags', { post_id: '00000000-0000-0000-0000-000000000000', tags: ['x'] }],
		['/api/user', { username: 'newname' }],
		['/api/identity/enroll', { blog_slug: 'x', idc: '1' }]
	])('POST %s → 401', async (path, body) => {
		const res = await postJSON(path, body);
		expect(res.status).toBe(401);
	});
});

describe('session-free writes: no 401, authorization is the proof', () => {
	// Without a session cookie these endpoints must NOT 401. With a missing/invalid
	// blog or a bogus proof they fail at resolution/verification (404/422/400),
	// never at an auth gate — proving the session is no longer consulted.
	it('POST /api/blog/post with no cookie → not 401 (404 unknown blog)', async () => {
		const res = await postJSON('/api/blog/post', {
			blog_slug: 'does-not-exist',
			title: 't',
			content: 'c',
			proof: stubProof
		});
		expect(res.status).not.toBe(401);
		expect(res.status).toBe(404);
	});

	it('POST /api/post/comment with no cookie → not 401 (404 unknown version)', async () => {
		const res = await postJSON('/api/post/comment', {
			post_version_id: '00000000-0000-0000-0000-000000000000',
			body: 'hi',
			proof: stubProof
		});
		expect(res.status).not.toBe(401);
		expect(res.status).toBe(404);
	});

	it('POST /api/blog/post/edit with no cookie → not 401 (404 unknown version)', async () => {
		const res = await postJSON('/api/blog/post/edit', {
			post_version_id: '00000000-0000-0000-0000-000000000000',
			title: 't',
			content: 'c',
			proof: stubProof
		});
		expect(res.status).not.toBe(401);
		expect(res.status).toBe(404);
	});
});
