// Operator-only listing of declared incidents. The parent
// /admin/platform/+layout.server.ts already gates the route on
// isPlatformOperator — no need to re-check here.
import type { PageServerLoad } from './$types';
import { listIncidentsForOperator } from '$lib/db/status';

export const load: PageServerLoad = async ({ url }) => {
	const filterParam = url.searchParams.get('filter') ?? 'active';
	const filter: 'active' | 'all' = filterParam === 'all' ? 'all' : 'active';
	const incidents = await listIncidentsForOperator(filter);
	return { incidents, filter };
};
