// Operator view of a single incident: header + timeline of updates +
// inline forms to post a new update or resolve the whole thing. Auth gate
// inherited from /admin/platform/+layout.server.ts.
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getIncidentWithUpdates } from '$lib/db/status';

export const load: PageServerLoad = async ({ params }) => {
	const data = await getIncidentWithUpdates(params.id);
	if (!data) throw error(404, 'incident not found');
	return data;
};
