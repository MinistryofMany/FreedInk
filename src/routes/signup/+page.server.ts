import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		signedIn: !!locals.user,
		username: locals.user?.username ?? null
	};
};
