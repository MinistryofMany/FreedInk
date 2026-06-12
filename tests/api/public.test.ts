import { describe, it, expect } from 'vitest';
import { api } from './helpers';

describe('public routes', () => {
	it('GET / → 200', async () => {
		const res = await api('/');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Freed');
	});

	it('GET /b → 200', async () => {
		const res = await api('/b');
		expect(res.status).toBe(200);
	});

	it('GET /search → 200', async () => {
		const res = await api('/search');
		expect(res.status).toBe(200);
	});

	it('GET /signup → 200', async () => {
		const res = await api('/signup');
		expect(res.status).toBe(200);
	});

	it('GET /admin without auth → 303 redirect', async () => {
		const res = await api('/admin', { redirect: 'manual' });
		expect([302, 303]).toContain(res.status);
		expect(res.headers.get('location')).toMatch(/\/signup$/);
	});

	it('GET /api/nonce → 200 and returns a non-empty nonce', async () => {
		const res = await api('/api/nonce');
		expect(res.status).toBe(200);
		const t = await res.text();
		expect(t.length).toBeGreaterThan(5);
	});

	it('GET unknown route → 404', async () => {
		const res = await api('/this/does/not/exist');
		expect(res.status).toBe(404);
	});
});
