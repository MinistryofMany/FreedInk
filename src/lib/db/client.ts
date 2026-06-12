import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

const url = env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const queryClient = postgres(url, {
	max: 10,
	idle_timeout: 30,
	prepare: false
});

export const db = drizzle(queryClient, { schema, logger: false });
export { schema };

// Exported so the graceful-shutdown hook can close the pool on SIGTERM/SIGINT.
// Safe to call multiple times — postgres-js ignores end() on a closed client.
export function closePool(opts: { timeoutSeconds?: number } = {}): Promise<void> {
	return queryClient.end({ timeout: opts.timeoutSeconds ?? 5 });
}
