import { describe, it, expect } from 'vitest';
import { api } from './helpers';

describe('legal pages', () => {
	it('GET /legal/privacy → 200 with Privacy Policy heading', async () => {
		const res = await api('/legal/privacy');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Privacy Policy');
	});

	it('GET /legal/terms → 200 with Terms of Service heading', async () => {
		const res = await api('/legal/terms');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Terms of Service');
	});

	it('GET /legal/dmca → 200 with DMCA agent text', async () => {
		const res = await api('/legal/dmca');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('DMCA');
		expect(html).toMatch(/dmca@freed\.ink/);
	});
});
