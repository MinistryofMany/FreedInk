// Operator-only: update a feature flag (enabled / rollout_percentage /
// description). The admin UI uses this for inline toggle / slider saves;
// it accepts both PATCH (partial update) and PUT (same semantics; we
// don't enforce a different shape) for symmetry with the rest of the
// flag-management surface.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isPlatformOperator } from '$lib/server/operators';
import { getFlag, setFlag } from '$lib/server/flags';

const Body = z.object({
	enabled: z.boolean().optional(),
	rollout_percentage: z.number().int().min(0).max(100).optional(),
	description: z.string().max(500).nullable().optional()
});

async function handle(event: Parameters<RequestHandler>[0]) {
	const { request, locals, params } = event;
	if (!locals.user) throw error(401, 'sign in required');
	if (!isPlatformOperator(locals.user)) throw error(403, 'platform operator only');

	const key = params.key;
	if (!key) throw error(404, 'flag not found');

	const existing = await getFlag(key);
	if (!existing) throw error(404, 'flag not found');

	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) throw error(422, parsed.error.message);

	const row = await setFlag(
		key,
		{
			enabled: parsed.data.enabled,
			rolloutPercentage: parsed.data.rollout_percentage,
			description: parsed.data.description
		},
		locals.user.id
	);

	return json({ ok: true, flag: row });
}

export const PATCH: RequestHandler = handle;
export const PUT: RequestHandler = handle;
