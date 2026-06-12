import { defineConfig } from 'drizzle-kit';
import { readFileSync, existsSync } from 'node:fs';

// Minimal .env loader so we don't need to depend on dotenv just for drizzle-kit.
if (existsSync('.env')) {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) {
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required (set in .env or env)');

export default defineConfig({
	schema: './src/lib/db/schema.ts',
	out: './migrations',
	dialect: 'postgresql',
	dbCredentials: { url },
	strict: true,
	verbose: true
});
