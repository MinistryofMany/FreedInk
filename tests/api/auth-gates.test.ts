import { describe, it, expect } from 'vitest';
import { postJSON, getJSON } from './helpers';

const stubProof = {
	merkleTreeDepth: 1,
	merkleTreeRoot: '0',
	nullifier: '0',
	message: '0',
	scope: '0',
	points: []
};

describe('auth gates: unauthenticated requests are rejected', () => {
	// NOTE: /api/blog/post, /api/blog/post/edit and /api/post/comment are NO LONGER
	// here — Phase 4 made them session-free (authorized purely by the Semaphore
	// proof). They are covered by the session-free describe below. /api/post/review
	// stays session-authed until Phase 5 (blind tokens).
	it.each([
		['/api/blog/create', { title: 't', description: 'd' }],
		['/api/blog/group', { blog_slug: 'x', capability: 'author' }],
		[
			'/api/blog/members',
			{ blog_id: '00000000-0000-0000-0000-000000000000', target: { username: 'x' }, role: 'author' }
		],
		['/api/blog/archive', { blog_id: '00000000-0000-0000-0000-000000000000', archive: true }],
		[
			'/api/post/review',
			{
				post_version_id: '00000000-0000-0000-0000-000000000000',
				vote: 'approve',
				proof: stubProof
			}
		],
		['/api/post/submit', { post_version_id: '00000000-0000-0000-0000-000000000000' }],
		['/api/post/tags', { post_id: '00000000-0000-0000-0000-000000000000', tags: ['x'] }],
		['/api/user', { username: 'newname' }],
		['/api/identity', { idc: '1' }],
		['/api/identity/rotate', { idc: '1' }]
	])('POST %s → 401', async (path, body) => {
		const res = await postJSON(path, body);
		expect(res.status).toBe(401);
	});

	it('GET /api/identity unauthed → 401', async () => {
		const res = await getJSON('/api/identity');
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
