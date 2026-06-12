import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const prerender = true;

const ORIGIN = env.PUBLIC_ORIGIN || 'https://freed.ink';

const body = `User-agent: *
Allow: /
Allow: /b
Allow: /b/
Allow: /search
Allow: /legal
Allow: /legal/
Disallow: /admin
Disallow: /admin/
Disallow: /api
Disallow: /api/
Disallow: /settings
Disallow: /settings/
Disallow: /signup
Disallow: /signup/
Disallow: /recover
Disallow: /recover/

Sitemap: ${ORIGIN}/sitemap.xml
`;

export const GET: RequestHandler = () => {
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
};
