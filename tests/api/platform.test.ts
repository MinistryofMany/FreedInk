// Platform-operator dashboard gating.
//
// PLATFORM_OPERATORS is configured to "platform-op" in .env.test. A user
// created with that username is an operator; everyone else is not.
import { describe, it, expect } from 'vitest';
import { api, asUser, BASE_URL } from './helpers';
import { makeUser } from '../setup/factories';

async function getHTML(path: string, cookie?: string): Promise<Response> {
	return fetch(BASE_URL + path, {
		method: 'GET',
		headers: cookie ? { cookie } : {},
		redirect: 'manual'
	});
}

describe('GET /admin/platform', () => {
	it('redirects an unauthenticated visitor', async () => {
		const res = await getHTML('/admin/platform');
		await res.text();
		expect(res.status).toBe(303);
	});

	it('redirects a non-operator signed-in user', async () => {
		const u = await makeUser({ username: 'regular' });
		const { cookie } = await asUser(u);
		const res = await getHTML('/admin/platform', cookie);
		await res.text();
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/admin');
	});

	it('renders for a platform operator', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await getHTML('/admin/platform', cookie);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html.toLowerCase()).toContain('platform');
	});

	it('users list shows seeded users for an operator', async () => {
		await makeUser({ username: 'seeded-1' });
		await makeUser({ username: 'seeded-2' });
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await getHTML('/admin/platform/users', cookie);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('seeded-1');
		expect(html).toContain('seeded-2');
	});

	it('audit page is reachable for an operator', async () => {
		const op = await makeUser({ username: 'platform-op' });
		const { cookie } = await asUser(op);
		const res = await getHTML('/admin/platform/audit', cookie);
		expect(res.status).toBe(200);
	});
});

// Sanity: a plain public route works without any platform-operator state.
describe('platform: orthogonality', () => {
	it('PLATFORM_OPERATORS does not affect non-platform routes', async () => {
		const res = await api('/api/push/vapid');
		await res.text();
		expect(res.status).toBe(200);
	});
});
