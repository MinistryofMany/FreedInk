import type { RequestHandler } from './$types';
import { z } from 'zod';
import { error, json } from '@sveltejs/kit';
import { updateUserProfile } from '$lib/db/users';

const Body = z.object({
	username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/).optional(),
	displayName: z.string().max(80).nullable().optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const body = Body.safeParse(await request.json());
	if (!body.success) throw error(422, body.error.message);
	const updated = await updateUserProfile(locals.user.id, body.data);
	if (!updated) throw error(500, 'update failed');
	return json({ user: updated });
};
