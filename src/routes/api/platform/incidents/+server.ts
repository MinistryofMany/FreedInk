// Operator-only: declare a new status-page incident. Returns { id } so the
// admin UI can navigate straight to the detail view.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isPlatformOperator } from '$lib/server/operators';
import { declareIncident } from '$lib/db/status';
import { audit } from '$lib/server/audit';

const Body = z.object({
	title: z.string().trim().min(1).max(200),
	level: z.enum(['operational', 'degraded', 'partial_outage', 'major_outage'])
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	if (!isPlatformOperator(locals.user)) throw error(403, 'platform operator only');

	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) throw error(422, parsed.error.message);

	const incident = await declareIncident({
		title: parsed.data.title,
		level: parsed.data.level,
		declaredByUserId: locals.user.id
	});

	await audit(event, {
		event: 'incident.declared',
		actorUserId: locals.user.id,
		metadata: {
			incident_id: incident.id,
			title: incident.title,
			level: incident.level
		}
	});

	return json({ id: incident.id });
};
