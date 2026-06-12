// Public /status page: anonymous GET returns 200, sets the public cache
// header, and includes the expected layout markers.
import { describe, it, expect } from 'vitest';
import { api } from './helpers';

describe('public /status', () => {
	it('GET → 200 with the public cache-control header', async () => {
		const res = await api('/status');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/text\/html/);
		const cc = res.headers.get('cache-control') ?? '';
		expect(cc).toMatch(/public/);
		expect(cc).toMatch(/max-age=30/);
	});

	it('renders the status page chrome (overall + uptime grid + incidents)', async () => {
		const res = await api('/status');
		const html = (await res.text()).toLowerCase();
		// Overall headline copy is one of the LABELS map values.
		expect(html).toMatch(
			/(all systems operational|degraded performance|partial outage|major outage)/
		);
		// Both the 90-day grid and the incidents sections are always present,
		// even when there's no data.
		expect(html).toContain('last 90 days');
		expect(html).toContain('active incidents');
		expect(html).toContain('updated');
	});
});
