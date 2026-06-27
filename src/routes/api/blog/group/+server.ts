import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBlogBySlug } from '$lib/db/blogs';
import { refreshSnapshot } from '$lib/db/snapshots';
import { requireCapability } from '$lib/server/auth';
import type { Capability } from '$lib/db/schema';

// Which capability a requested tree corresponds to. Only the tree capabilities
// are fetchable (author/comment for the per-device proofs; review transitionally
// until Phase 5). 'admin' has no tree.
const CapabilityEnum = z.enum(['author', 'comment', 'review']);
const Body = z.object({
	blog_slug: z.string().min(1),
	capability: CapabilityEnum
});

// Returns the current eligible identity set + matching root for ONE capability
// tree. Auth-gated (design D4 — only the WRITE is identity-free; the read that
// builds the proof stays session-gated so tree membership isn't public).
//
// Authorization: the caller must themselves hold the requested capability — a
// member fetches only the trees they can prove against. This is the capability
// equivalent of the old ROLES_PROVING gate, but pinned to the exact tree.
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const blog = await getBlogBySlug(parsed.data.blog_slug);
	if (!blog) throw error(404, 'blog not found');

	const capability = parsed.data.capability as Capability;
	await requireCapability(blog.id, locals.user.id, capability);

	const snap = await refreshSnapshot(blog.id, parsed.data.capability);
	return json({
		root: snap.root,
		identities: snap.identities,
		eligible_count: snap.eligibleCount
	});
};
