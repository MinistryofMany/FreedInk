// Cross-blog abuse-report queue for the service operator. Read-only: the
// operator acts on a report by opening the target's per-blog moderation page
// (hide/restore live there). Gated by the parent ops layout (isFreedinkOperator).
import type { PageServerLoad } from './$types';
import { listReports, type ReportStatus } from '$lib/db/reports';
import { db, schema } from '$lib/db/client';
import { eq, inArray } from 'drizzle-orm';

const STATUSES: ReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

export const load: PageServerLoad = async ({ url }) => {
	const statusParam = url.searchParams.get('status');
	const status: ReportStatus | null =
		statusParam && (STATUSES as string[]).includes(statusParam)
			? (statusParam as ReportStatus)
			: 'open';

	const { items, total } = await listReports({ status, limit: 100 });

	// Resolve a moderation link for post/comment targets: post → its blog's
	// moderation detail; comment → the moderation detail of the post it hangs off.
	const postIds = items.filter((r) => r.targetType === 'post').map((r) => r.targetId);
	const commentIds = items.filter((r) => r.targetType === 'comment').map((r) => r.targetId);

	const postLink = new Map<string, string>();
	if (postIds.length > 0) {
		const rows = await db
			.select({ postId: schema.blogPosts.id, slug: schema.blogs.slug })
			.from(schema.blogPosts)
			.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
			.where(inArray(schema.blogPosts.id, postIds));
		for (const r of rows) postLink.set(r.postId, `/admin/b/${r.slug}/posts/${r.postId}`);
	}

	const commentLink = new Map<string, string>();
	if (commentIds.length > 0) {
		const rows = await db
			.select({
				commentId: schema.postComments.id,
				postId: schema.blogPosts.id,
				slug: schema.blogs.slug
			})
			.from(schema.postComments)
			.innerJoin(
				schema.blogPostVersions,
				eq(schema.blogPostVersions.id, schema.postComments.postVersionId)
			)
			.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
			.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
			.where(inArray(schema.postComments.id, commentIds));
		for (const r of rows) commentLink.set(r.commentId, `/admin/b/${r.slug}/posts/${r.postId}`);
	}

	return {
		status,
		statuses: STATUSES,
		total,
		reports: items.map((r) => ({
			id: r.id,
			targetType: r.targetType,
			targetId: r.targetId,
			reason: r.reason,
			details: r.details,
			status: r.status,
			createdAt: r.createdAt.toISOString(),
			reporterUsername: r.reporterUsername,
			moderationLink:
				r.targetType === 'post'
					? (postLink.get(r.targetId) ?? null)
					: r.targetType === 'comment'
						? (commentLink.get(r.targetId) ?? null)
						: null
		}))
	};
};
