import type { RequestHandler } from './$types';
import { generateNonce } from 'siwe';
import { db, schema } from '$lib/db/client';
import { lt } from 'drizzle-orm';
import { enforce, RULES } from '$lib/server/rate-limit';

const NONCE_TTL_MS = 10 * 60 * 1000;

export const GET: RequestHandler = async (event) => {
	await enforce(RULES.nonce, event, { keyBy: 'ip' });
	const nonce = generateNonce();
	const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
	await db.insert(schema.siweNonces).values({ nonce, expiresAt });
	// Best-effort gc.
	await db.delete(schema.siweNonces).where(lt(schema.siweNonces.expiresAt, new Date()));
	return new Response(nonce, { status: 200 });
};
