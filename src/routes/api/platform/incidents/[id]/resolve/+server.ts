// Operator-only: close an incident. Sets status='resolved' + resolved_at=now,
// and appends a final "resolved" update to the timeline so the public page
// has a closing line. Body is optional; missing/empty produces a default.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isPlatformOperator } from '$lib/server/operators';
import { resolveIncident } from '$lib/db/status';
import { audit } from '$lib/server/audit';

const Body = z.object({
	body: z.string().trim().max(4000).optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals, params } = event;
	if (!locals.user) throw error(401, 'sign in required');
	if (!isPlatformOperator(locals.user)) throw error(403, 'platform operator only');

	const idCheck = z.string().uuid().safeParse(params.id);
	if (!idCheck.success) throw error(404, 'invalid incident id');

	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) throw error(422, parsed.error.message);

	const result = await resolveIncident({
		incidentId: idCheck.data,
		postedByUserId: locals.user.id,
		body: parsed.data.body ?? null
	});
	if (!result) throw error(404, 'incident not found');

	await audit(event, {
		event: 'incident.resolved',
		actorUserId: locals.user.id,
		metadata: {
			incident_id: result.incident.id,
			update_id: result.update.id
		}
	});

	return json({ ok: true });
};
