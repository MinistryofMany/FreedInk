import { describe, it, expect } from 'vitest';
import { api } from './helpers';

describe('discovery: robots / sitemap / llms', () => {
	it('GET /robots.txt → 200 plain-text with Sitemap and Disallows', async () => {
		const res = await api('/robots.txt');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type') ?? '').toMatch(/text\/plain/);
		const body = await res.text();
		expect(body).toMatch(/Sitemap:\s*https?:\/\//);
		expect(body).toMatch(/Disallow:\s*\/admin/);
		expect(body).toMatch(/Disallow:\s*\/api/);
		expect(body).toMatch(/Disallow:\s*\/settings/);
	});

	it('GET /sitemap.xml → 200 XML containing the home URL', async () => {
		const res = await api('/sitemap.xml');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type') ?? '').toMatch(/xml/);
		const body = await res.text();
		expect(body).toMatch(/<\?xml/);
		expect(body).toMatch(/<urlset[^>]*>/);
		expect(body).toMatch(/<loc>https?:\/\/[^/]+\/<\/loc>/);
	});

	it('GET /llms.txt → 200 markdown body', async () => {
		const res = await api('/llms.txt');
		expect(res.status).toBe(200);
		// SvelteKit / adapter-node may normalize text/markdown to text/plain
		// depending on the static-asset mime table. Accept either.
		expect(res.headers.get('content-type') ?? '').toMatch(/text\/(markdown|plain)/);
		const body = await res.text();
		expect(body).toMatch(/^#\s*FreedInk/m);
		expect(body).toMatch(/Do not crawl/i);
		expect(body).toMatch(/\/api\//);
	});
});
