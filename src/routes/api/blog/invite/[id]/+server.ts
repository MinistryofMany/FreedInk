// DELETE /api/blog/invite/[id] — revoke an outstanding invitation. Owner-only;
// the ownership check happens inside revokeInvitation so callers don't have to
// re-derive the parent blog id from the invitation id.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { revokeInvitation } from '$lib/db/invitations';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const id = params.id;
	if (!id) throw error(422, 'missing invitation id');
	const result = await revokeInvitation(id, locals.user.id);
	return json(result);
};
