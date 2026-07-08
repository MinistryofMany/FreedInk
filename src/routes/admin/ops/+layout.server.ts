// Gate every /admin/ops/* surface behind the FreedInk service-operator check
// (FREEDINK_OPERATOR_SUBS). Fails closed: a signed-out user, a signed-in
// non-operator, or an unset/empty allowlist all get bounced to /admin.
//
// The operator's own Minister subject(s) are surfaced here so a fresh deploy can
// read the value off the ops UI and pin it into FREEDINK_OPERATOR_SUBS.
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isFreedinkOperator, operatorAllowlistConfigured } from '$lib/server/operators';
import { getOidcSubjectsForUser } from '$lib/db/oidc';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user || !(await isFreedinkOperator(locals.user.id))) {
		throw redirect(303, '/admin');
	}
	const subjects = await getOidcSubjectsForUser(locals.user.id);
	return {
		operator: {
			id: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName,
			subjects
		},
		allowlistConfigured: operatorAllowlistConfigured()
	};
};
