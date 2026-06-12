// Operator-only: post an update to an existing incident. The update body
// becomes part of the public timeline; the incident's status mirrors the
// most recent update's status.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isPlatformOperator } from '$lib/server/operators';
import { postIncidentUpdate } from '$lib/db/status';
import { audit } from '$lib/server/audit';

const Body = z.object({
	status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
	body: z.string().trim().min(1).max(4000)
});

export const POST: RequestHandler = async (event) => {
	const { request, locals, params } = event;
	if (!locals.user) throw error(401, 'sign in required');
	if (!isPlatformOperator(locals.user)) throw error(403, 'platform operator only');

	const idCheck = z.string().uuid().safeParse(params.id);
	if (!idCheck.success) throw error(404, 'invalid incident id');

	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) throw error(422, parsed.error.message);

	const result = await postIncidentUpdate({
		incidentId: idCheck.data,
		status: parsed.data.status,
		body: parsed.data.body,
		postedByUserId: locals.user.id
	});
	if (!result) throw error(404, 'incident not found');

	await audit(event, {
		event: 'incident.updated',
		actorUserId: locals.user.id,
		metadata: {
			incident_id: result.incident.id,
			update_id: result.update.id,
			status: result.update.status
		}
	});

	return json({ ok: true, update_id: result.update.id });
};
