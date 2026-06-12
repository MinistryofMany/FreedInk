// Verifies the security middleware in src/hooks.server.ts is wired:
//   - CSP, XFO, nosniff, Referrer-Policy, Permissions-Policy on normal routes
//   - /healthz is exempt from CSP+HSTS (machine-consumed; cleaner without)
//   - HSTS is conditional on https (test server runs http, so we assert
//     HSTS is *absent* here — proves the dev/proto guard is doing its job)
//   - X-Request-Id is echoed on every response
import { describe, it, expect } from 'vitest';
import { api } from './helpers';

const EXPECTED_PERMISSIONS_POLICY =
	'camera=(), microphone=(), geolocation=(), payment=(), ' +
	'publickey-credentials-get=(self), publickey-credentials-create=(self)';

describe('security headers', () => {
	it('GET / sets CSP, XFO, nosniff, Referrer-Policy, Permissions-Policy', async () => {
		const res = await api('/');
		expect(res.status).toBe(200);
		// Drain body so the socket can be released.
		await res.text();

		const csp = res.headers.get('content-security-policy');
		expect(csp).toBeTruthy();
		expect(csp).toContain("default-src 'self'");
		// WASM eval is required for the Semaphore prover.
		expect(csp).toContain("'wasm-unsafe-eval'");
		// connect-src includes the snark artifact CDN fallback.
		expect(csp).toContain('https://snark-artifacts.pse.dev');
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("object-src 'none'");

		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(res.headers.get('permissions-policy')).toBe(EXPECTED_PERMISSIONS_POLICY);
		expect(res.headers.get('x-request-id')).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
	});

	it('GET /api/nonce sets the same baseline non-CSP headers', async () => {
		// SvelteKit applies CSP via its own emit-on-document path (only HTML
		// pages get the CSP header). JSON API responses don't include it,
		// which is correct — CSP doesn't apply to non-document content. The
		// other headers come from hooks.server.ts and apply to all responses.
		const res = await api('/api/nonce');
		await res.text();
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(res.headers.get('permissions-policy')).toBe(EXPECTED_PERMISSIONS_POLICY);
		expect(res.headers.get('x-request-id')).toBeTruthy();
	});

	it('GET /healthz is exempt from CSP and HSTS, but still has the cheap headers', async () => {
		const res = await api('/healthz');
		await res.text();
		expect(res.headers.get('content-security-policy')).toBeNull();
		expect(res.headers.get('strict-transport-security')).toBeNull();
		// Still safe to set these — they don't break health-check tooling.
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(res.headers.get('x-request-id')).toBeTruthy();
	});

	it('HSTS is NOT set on plain-http requests (dev/test environments)', async () => {
		const res = await api('/');
		await res.text();
		// Test server runs http, so HSTS must be absent. In prod-over-https
		// the header would be set; we trust that path manually via curl in
		// the verification step from the task spec.
		expect(res.headers.get('strict-transport-security')).toBeNull();
	});

	it('echoes a client-provided X-Request-Id when supplied', async () => {
		const provided = '11111111-2222-3333-4444-555555555555';
		const res = await api('/api/nonce', { headers: { 'x-request-id': provided } });
		await res.text();
		expect(res.headers.get('x-request-id')).toBe(provided);
	});
});
