// Platform overview: enriched dashboard for operators. Pulls counts via the
// shared metrics helpers (same numbers /metrics exposes), assembles three
// 30-day sparkline series, and tails the audit log with an optional event-
// type filter. All work happens server-side so the page is a single round
// trip from the browser.
import type { PageServerLoad } from './$types';
import { db, schema } from '$lib/db/client';
import { sql, desc } from 'drizzle-orm';
import {
	countUsersTotal,
	countActiveUsers,
	countBlogs,
	countPublishedPostVersions,
	countReviewsSince,
	countCommentsSince,
	countAbuseReportsOpen,
	dailyNewUsers,
	dailyNewPosts,
	dailyNewComments,
	type DailyBucket
} from '$lib/server/metrics';

const AUDIT_LIMIT = 100;

export const load: PageServerLoad = async ({ url }) => {
	const eventFilter = url.searchParams.get('event')?.trim() || null;
	const enumValues = schema.auditEvent.enumValues as readonly string[];
	const validFilter = eventFilter && enumValues.includes(eventFilter) ? eventFilter : null;

	const [
		usersTotal,
		activeUsers,
		blogsActive,
		publishedPosts,
		commentsCount7d,
		reviewsCast7d,
		reportsOpen,
		newUsers,
		newPosts,
		newComments
	] = await Promise.all([
		countUsersTotal(),
		countActiveUsers(7),
		countBlogs({ archived: false }),
		countPublishedPostVersions(),
		countCommentsSince(7),
		countReviewsSince(7),
		countAbuseReportsOpen(),
		dailyNewUsers(30),
		dailyNewPosts(30),
		dailyNewComments(30)
	]);

	// Keep the existing total-comments tile so the "Comments" card retains
	// the all-time count it used to show.
	const [commentTotalRow] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.postComments);
	const commentsTotal = commentTotalRow?.n ?? 0;

	// Audit tail with optional event-type filter. We sidestep Drizzle's narrow
	// enum typing for `eq(auditLog.event, …)` by using a raw SQL fragment;
	// `validFilter` is already constrained to the enum's value set above, so
	// no SQL-injection surface.
	const audit = await db
		.select({
			id: schema.auditLog.id,
			event: schema.auditLog.event,
			actorUserId: schema.auditLog.actorUserId,
			subjectUserId: schema.auditLog.subjectUserId,
			subjectBlogId: schema.auditLog.subjectBlogId,
			metadata: schema.auditLog.metadata,
			createdAt: schema.auditLog.createdAt
		})
		.from(schema.auditLog)
		.where(validFilter ? sql`${schema.auditLog.event} = ${validFilter}::audit_event` : sql`true`)
		.orderBy(desc(schema.auditLog.createdAt))
		.limit(AUDIT_LIMIT);

	return {
		stats: {
			users: usersTotal,
			activeUsers,
			blogs: blogsActive,
			publishedPosts,
			comments: commentsTotal,
			comments7d: commentsCount7d,
			reviews7d: reviewsCast7d,
			reportsOpen
		},
		sparklines: {
			users: newUsers,
			posts: newPosts,
			comments: newComments
		} satisfies Record<string, DailyBucket[]>,
		audit,
		eventFilter: validFilter,
		eventTypes: enumValues
	};
};
