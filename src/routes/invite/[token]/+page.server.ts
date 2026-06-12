// Public landing for invitation links. We expose enough of the invitation
// context to render a useful page, but we don't auto-accept here — the user
// either clicks the CTA (signed in) or goes through signup carrying the token
// in the URL.
import type { PageServerLoad } from './$types';
import { getInvitationByToken } from '$lib/db/invitations';

export const load: PageServerLoad = async ({ params, locals }) => {
	const ctx = await getInvitationByToken(params.token);
	if (!ctx) {
		return {
			invitation: null as null,
			token: params.token,
			signedIn: !!locals.user,
			username: locals.user?.username ?? null
		};
	}
	return {
		invitation: {
			blogTitle: ctx.blogTitle,
			blogSlug: ctx.blogSlug,
			role: ctx.role,
			email: ctx.email,
			inviterUsername: ctx.inviterUsername,
			expiresAt: ctx.expiresAt.toISOString()
		},
		token: params.token,
		signedIn: !!locals.user,
		username: locals.user?.username ?? null
	};
};
