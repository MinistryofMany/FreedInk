import type { PageServerLoad } from './$types';
import { oidcEnabled } from '$lib/server/oidc';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		signedIn: !!locals.user,
		username: locals.user?.username ?? null,
		// Only show "Sign in with Tessera" when the OIDC client is configured.
		tesseraEnabled: oidcEnabled()
	};
};
