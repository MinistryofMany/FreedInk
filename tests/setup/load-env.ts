// Load .env.test into process.env before any module that reads env (drizzle
// client, session, webauthn, etc.) is imported. Vitest globalSetup runs once
// per worker; the per-file setup (`setupFiles`) runs once per file. We need
// this to land first.
import { readFileSync, existsSync } from 'node:fs';

const file = '.env.test';
if (existsSync(file)) {
	for (const raw of readFileSync(file, 'utf8').split('\n')) {
		const line = raw.replace(/\r$/, '');
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) {
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
}

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL not set — .env.test missing or malformed');
}
if (!process.env.SESSION_SECRET) {
	throw new Error('SESSION_SECRET not set in .env.test');
}
