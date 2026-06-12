import { BASE_URL } from '../setup/server';
import { createSession, packCookie } from '$lib/server/session';
import type { TestUser } from '../setup/factories';

export { BASE_URL };

// Build a request init with the cookie header for a user, optionally with a
// JSON body. Returns a wrapper that auto-prepends BASE_URL.
export function api(path: string, opts: RequestInit = {}): Promise<Response> {
	const url = path.startsWith('http') ? path : BASE_URL + path;
	return fetch(url, opts);
}

export async function asUser(user: TestUser): Promise<{ cookie: string }> {
	const sid = await createSession(user.id, { userAgent: 'vitest', ip: '127.0.0.1' });
	return { cookie: `sid=${packCookie(sid)}` };
}

export async function postJSON(
	path: string,
	body: unknown,
	opts: { cookie?: string } = {}
): Promise<Response> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (opts.cookie) headers.cookie = opts.cookie;
	return api(path, {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});
}

export async function getJSON(
	path: string,
	opts: { cookie?: string } = {}
): Promise<Response> {
	const headers: Record<string, string> = {};
	if (opts.cookie) headers.cookie = opts.cookie;
	return api(path, { headers });
}
