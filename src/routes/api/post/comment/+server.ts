import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
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
	body: z.string().min(1).max(4000),
	proof: ProofSchema
});

export const POST: RequestHandler = async (event) => {
	// Session-free write (Phase 4): authorization is the commenters-tree proof,
	// not a session. Rate-limit by IP; never read locals.user.
	await enforce(RULES.commentPost, event, { keyBy: 'ip' });
	const { request } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const versionRows = await db
		.select({ version: schema.blogPostVersions, post: schema.blogPosts })
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.blogPostVersions.id, parsed.data.post_version_id))
		.limit(1);
	const row = versionRows[0];
	if (!row) throw error(404, 'post version not found');

	const expectedScope = `comment:${parsed.data.post_version_id}`;
	const expectedMessage = parsed.data.body;
	const { snapshot, nullifier } = await verifyMembership({
		blogId: row.post.blogId,
		// Commenting proves membership in the COMMENTERS tree (can_comment holders).
		capability: 'comment',
		proof: parsed.data.proof,
		expectedScope,
		expectedMessage,
		// D11: require the CURRENT commenters-tree root. This kills the
		// stale-comment-after-revoke vector (a just-revoked device commenting on an
		// old root) AND closes the R1 historical-cross-tree-root match (an author
		// proof matching a historical comment root that equalled the author root at
		// blog creation). The tradeoff: a member who just lost comment rights can't
		// comment on an old version — acceptable.
		requireCurrentRoot: true
	});

	let inserted;
	try {
		[inserted] = await db
			.insert(schema.postComments)
			.values({
				postVersionId: parsed.data.post_version_id,
				body: parsed.data.body,
				proof: parsed.data.proof,
				snapshotRoot: snapshot.root,
				nullifier
			})
			.returning();
	} catch (e) {
		if (isUniqueViolation(e)) throw error(409, 'duplicate comment (nullifier reuse)');
		throw e;
	}
	await audit(event, {
		event: 'comment.posted',
		// Anonymous content action: record IP/UA but never the acting member.
		anonymous: true,
		subjectBlogId: row.post.blogId,
		metadata: {
			post_id: row.post.id,
			version_id: parsed.data.post_version_id,
			comment_id: inserted.id
		}
	});
	return json({
		ok: true,
		comment: { id: inserted.id, body: inserted.body, createdAt: inserted.createdAt }
	});
};
