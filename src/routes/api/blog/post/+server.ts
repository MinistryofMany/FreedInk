import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBlogBySlug } from '$lib/db/blogs';
import { createPost } from '$lib/db/posts';
import { requireRole, ROLES_WRITING } from '$lib/server/auth';
import { verifyMembership } from '$lib/server/semaphore';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';
import { isUniqueViolation } from '$lib/server/db-errors';
import { notifyReviewersOfNewSubmission } from '$lib/server/notifications';
import { isValidLanguageCode, normalizeLanguageCode } from '$lib/languages';

const ProofSchema = z.object({
	merkleTreeDepth: z.number().int().positive(),
	merkleTreeRoot: z.string(),
	nullifier: z.string(),
	message: z.string(),
	scope: z.string(),
	points: z.array(z.string())
});

const Body = z.object({
	blog_slug: z.string().min(1),
	title: z.string().min(1).max(300),
	content: z.string().min(1).max(200_000),
	proof: ProofSchema,
	submit_for_review: z.boolean().default(true),
	// Optional. Server normalizes to a known code, falls back to the blog's
	// defaultLanguage if missing.
	language: z
		.string()
		.refine((s) => isValidLanguageCode(s), 'unsupported language code')
		.optional()
});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.postCreate, event, { keyBy: 'user' });
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	const { blog_slug, title, content, proof, submit_for_review, language } = parsed.data;

	const blog = await getBlogBySlug(blog_slug);
	if (!blog) throw error(404, 'blog not found');
	await requireRole(blog.id, locals.user.id, ROLES_WRITING);

	const expectedScope = `post:${blog.id}`;
	const expectedMessage = `${title}\n\n${content}`;
	const { snapshot, nullifier } = await verifyMembership({
		blogId: blog.id,
		proof,
		expectedScope,
		expectedMessage,
		// A removed or rotated-away member must not be able to author: the
		// proof has to match the blog's current proving-eligible snapshot.
		requireCurrentRoot: true
	});

	const status = submit_for_review ? 'under_review' : 'draft';
	let result;
	try {
		result = await createPost({
			blogId: blog.id,
			title,
			content,
			proof,
			snapshotRoot: snapshot.root,
			nullifier,
			status,
			language: language ? normalizeLanguageCode(language) : undefined
		});
	} catch (err) {
		if (isUniqueViolation(err)) throw error(409, 'duplicate submission (nullifier reuse)');
		throw err;
	}
	if (submit_for_review) {
		await audit(event, {
			event: 'post.submitted',
			// Anonymous content action: record IP/UA but never the acting member.
			anonymous: true,
			subjectBlogId: blog.id,
			metadata: { post_id: result.post.id, version_id: result.version.id, title }
		});
		// Fire-and-forget: email reviewers. Failure must never block the
		// submit response, so we void the promise and swallow inside.
		void notifyReviewersOfNewSubmission(blog.id, result.version.id);
	}
	return json({ ok: true, post_id: result.post.id, version_id: result.version.id });
};
