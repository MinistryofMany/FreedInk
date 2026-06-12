import type { PageServerLoad } from './$types';
import { lookupRecovery } from '$lib/server/recovery';

export const load: PageServerLoad = async ({ url }) => {
	const token = url.searchParams.get('token') ?? null;
	if (!token) return { token: null, valid: false as const, email: null };

	const valid = await lookupRecovery(token);
	if (!valid) return { token, valid: false as const, email: null };
	return {
		token,
		valid: true as const,
		email: valid.user.email,
		username: valid.user.username
	};
};
