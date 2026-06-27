// Edit a post: the author (or any role in ROLES_WRITING on the blog) submits
// a new version. The new version is created with version = current+1, the
// post's current_version_id is updated, and (optionally) the post is sent
// straight to under_review.
//
// Scope/nullifier design: we use `edit:<post_id>:<version_number>` as the
// proof scope. This means each version has its own nullifier space — the
// same identity can edit the same post multiple times (one edit per version
// per identity, but versions accumulate). Compare to creation, which uses
// `post:<blog_id>` (blog-scoped, identity can submit multiple posts because
// each post gets its own row). The trade-off here: an editor with one
// identity could spam many tiny edits to bump version numbers. We accept
// that — they already have ROLES_WRITING and rate-limiting bounds the flood.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { createPostVersion, getEditablePostForUser } from '$lib/db/post-editor';
import { requireRole, ROLES_WRITING } from '$lib/server/auth';
import { verifyMembership } from '$lib/server/semaphore';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';
import { isUniqueViolation } from '$lib/server/db-errors';

const ProofSchema = z.object({
	merkleTreeDepth: z.number().int().positive(),
	merkleTreeRoot: z.string(),
	nullifier: z.string(),
	message: z.string(),
	scope: z.string(),
	points: z.array(z.string())
});

const Body = z.object({
	post_version_id: z.string().uuid(),
	title: z.string().min(1).max(300),
	content: z.string().min(1).max(200_000),
	proof: ProofSchema,
	submit_for_review: z.boolean().default(true),
	language: z.string().optional()
});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.postCreate, event, { keyBy: 'user' });
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	const { post_version_id, title, content, proof, submit_for_review, language } = parsed.data;

	// Resolve + auth: must be on a *current* version of a post in a blog where
	// this user has writing rights. getEditablePostForUser does both checks.
	const row = await getEditablePostForUser(post_version_id, locals.user.id);
	// Belt-and-suspenders — even though getEditablePostForUser already calls
	// hasRole, requireRole emits the standard 403 path for callers that read
	// audit/log entries by event.
	await requireRole(row.post.blogId, locals.user.id, ROLES_WRITING);

	const nextVersionNumber = row.version.version + 1;
	const expectedScope = `edit:${row.post.id}:${nextVersionNumber}`;
	const expectedMessage = `${title}\n\n${content}`;
	const { snapshot, nullifier } = await verifyMembership({
		blogId: row.post.blogId,
		proof,
		expectedScope,
		expectedMessage,
		// Same rule as authoring: an edit must be proven against the current
		// snapshot, so a removed/rotated member can't push new versions.
		requireCurrentRoot: true
	});

	let result;
	try {
		const { normalizeLanguageCode, isValidLanguageCode } = await import('$lib/languages');
		const lang =
			language && isValidLanguageCode(language) ? normalizeLanguageCode(language) : undefined;
		result = await createPostVersion({
			postId: row.post.id,
			title,
			content,
			proof,
			snapshotRoot: snapshot.root,
			nullifier,
			submitForReview: submit_for_review,
			language: lang
		});
	} catch (err) {
		if (isUniqueViolation(err)) throw error(409, 'duplicate edit (nullifier reuse)');
		throw err;
	}

	await audit(event, {
		event: 'post.edited',
		// Anonymous content action: record IP/UA but never the acting member.
		anonymous: true,
		subjectBlogId: row.post.blogId,
		metadata: {
			post_id: row.post.id,
			previous_version_id: row.version.id,
			new_version_id: result.version.id,
			new_version: result.nextVersion,
			submitted_for_review: submit_for_review,
			title
		}
	});

	return json({
		ok: true,
		post_id: row.post.id,
		version_id: result.version.id,
		version: result.nextVersion
	});
};
