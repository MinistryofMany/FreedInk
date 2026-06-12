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
	it.each([
		['/api/blog/create', { title: 't', description: 'd' }],
		['/api/blog/group', { blog_slug: 'x' }],
		['/api/blog/post', { blog_slug: 'x', title: 't', content: 'c', proof: stubProof }],
		[
			'/api/blog/members',
			{ blog_id: '00000000-0000-0000-0000-000000000000', target: { username: 'x' }, role: 'author' }
		],
		[
			'/api/blog/archive',
			{ blog_id: '00000000-0000-0000-0000-000000000000', archive: true }
		],
		[
			'/api/post/review',
			{
				post_version_id: '00000000-0000-0000-0000-000000000000',
				vote: 'approve',
				proof: stubProof
			}
		],
		[
			'/api/post/comment',
			{
				post_version_id: '00000000-0000-0000-0000-000000000000',
				body: 'hi',
				proof: stubProof
			}
		],
		[
			'/api/post/submit',
			{ post_version_id: '00000000-0000-0000-0000-000000000000' }
		],
		[
			'/api/post/tags',
			{ post_id: '00000000-0000-0000-0000-000000000000', tags: ['x'] }
		],
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

	it('POST /api/auth/passkey/add unauthed → 401', async () => {
		const res = await postJSON('/api/auth/passkey/add', {});
		expect(res.status).toBe(401);
	});
});
