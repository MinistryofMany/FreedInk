// Gate every /admin/platform/* page behind the platform-operator check.
// Non-operators (including signed-out users) get bounced to /admin.
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isPlatformOperator } from '$lib/server/operators';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user || !isPlatformOperator(locals.user)) {
		throw redirect(303, '/admin');
	}
	return {
		operator: { id: locals.user.id, username: locals.user.username }
	};
};
