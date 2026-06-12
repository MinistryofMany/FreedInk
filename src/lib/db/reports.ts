// DB queries against abuse_reports. Lives under src/lib/db (not server)
// because it's pure SQL — no auth or HTTP concerns. The API endpoints
// wrap these with the policy decisions (operator-only, rate limits, etc).
import { db, schema } from './client';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export type ReportTarget = 'post' | 'comment' | 'user' | 'blog';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export type AbuseReport = typeof schema.abuseReports.$inferSelect;

export type CreateReportInput = {
	reporterUserId?: string | null;
	reporterIp?: string | null;
	targetType: ReportTarget;
	targetId: string;
	reason: string;
	details?: string | null;
};

export async function createReport(input: CreateReportInput): Promise<AbuseReport> {
	const [row] = await db
		.insert(schema.abuseReports)
		.values({
			reporterUserId: input.reporterUserId ?? null,
			reporterIp: input.reporterIp ?? null,
			targetType: input.targetType,
			targetId: input.targetId,
			reason: input.reason,
			details: input.details ?? null,
			status: 'open'
		})
		.returning();
	return row;
}

export async function getReportById(id: string): Promise<AbuseReport | null> {
	const rows = await db
		.select()
		.from(schema.abuseReports)
		.where(eq(schema.abuseReports.id, id))
		.limit(1);
	return rows[0] ?? null;
}

// Page of reports, with optional status filter. We also hydrate the
// reporter username when present (a single LEFT JOIN — there's only one
// reporter per row).
export type ListReportsOpts = {
	status?: ReportStatus | null;
	limit?: number;
	offset?: number;
};

export type ReportListItem = AbuseReport & {
	reporterUsername: string | null;
};

export async function listReports(
	opts: ListReportsOpts = {}
): Promise<{ items: ReportListItem[]; total: number }> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const offset = Math.max(opts.offset ?? 0, 0);

	const filters: SQL[] = [];
	if (opts.status) filters.push(eq(schema.abuseReports.status, opts.status));
	const whereClause = filters.length ? and(...filters) : undefined;

	const itemsQ = db
		.select({
			id: schema.abuseReports.id,
			reporterUserId: schema.abuseReports.reporterUserId,
			reporterIp: schema.abuseReports.reporterIp,
			targetType: schema.abuseReports.targetType,
			targetId: schema.abuseReports.targetId,
			reason: schema.abuseReports.reason,
			details: schema.abuseReports.details,
			status: schema.abuseReports.status,
			resolvedByUserId: schema.abuseReports.resolvedByUserId,
			resolvedAt: schema.abuseReports.resolvedAt,
			resolutionNotes: schema.abuseReports.resolutionNotes,
			createdAt: schema.abuseReports.createdAt,
			reporterUsername: schema.users.username
		})
		.from(schema.abuseReports)
		.leftJoin(schema.users, eq(schema.users.id, schema.abuseReports.reporterUserId))
		.orderBy(desc(schema.abuseReports.createdAt))
		.limit(limit)
		.offset(offset);

	const items = whereClause
		? ((await itemsQ.where(whereClause)) as ReportListItem[])
		: ((await itemsQ) as ReportListItem[]);

	const countQ = db.select({ n: sql<number>`count(*)::int` }).from(schema.abuseReports);
	const countRows = whereClause ? await countQ.where(whereClause) : await countQ;

	return { items, total: countRows[0]?.n ?? 0 };
}

// Resolve / dismiss are nearly identical writes — wrap them in one helper
// and let the API endpoints supply the status they want plus the actor
// for the resolved_by_user_id column.
export async function setReportStatus(opts: {
	id: string;
	status: 'resolved' | 'dismissed' | 'reviewing' | 'open';
	resolvedByUserId?: string | null;
	resolutionNotes?: string | null;
}): Promise<AbuseReport | null> {
	const isTerminal = opts.status === 'resolved' || opts.status === 'dismissed';
	const update: Record<string, unknown> = { status: opts.status };
	if (isTerminal) {
		update.resolvedByUserId = opts.resolvedByUserId ?? null;
		update.resolvedAt = new Date();
		if (opts.resolutionNotes !== undefined) {
			update.resolutionNotes = opts.resolutionNotes;
		}
	} else {
		update.resolvedAt = null;
		update.resolvedByUserId = null;
	}
	const rows = await db
		.update(schema.abuseReports)
		.set(update)
		.where(eq(schema.abuseReports.id, opts.id))
		.returning();
	return rows[0] ?? null;
}

// Used by the /api/report endpoint to validate that the thing being
// reported actually exists. The target_type column is a closed enum so we
// switch on it; FK enforcement isn't possible at the schema level (the
// column points to multiple tables) so we do it in code.
export async function targetExists(targetType: ReportTarget, targetId: string): Promise<boolean> {
	switch (targetType) {
		case 'post': {
			const rows = await db
				.select({ id: schema.blogPosts.id })
				.from(schema.blogPosts)
				.where(eq(schema.blogPosts.id, targetId))
				.limit(1);
			return rows.length > 0;
		}
		case 'comment': {
			const rows = await db
				.select({ id: schema.postComments.id })
				.from(schema.postComments)
				.where(eq(schema.postComments.id, targetId))
				.limit(1);
			return rows.length > 0;
		}
		case 'user': {
			const rows = await db
				.select({ id: schema.users.id })
				.from(schema.users)
				.where(eq(schema.users.id, targetId))
				.limit(1);
			return rows.length > 0;
		}
		case 'blog': {
			const rows = await db
				.select({ id: schema.blogs.id })
				.from(schema.blogs)
				.where(eq(schema.blogs.id, targetId))
				.limit(1);
			return rows.length > 0;
		}
	}
}

// Build the admin-side link for navigating to the target. We don't link
// users (no public user page exists yet) — operator just sees the UUID.
export function targetLinkFor(targetType: ReportTarget, targetId: string): string | null {
	switch (targetType) {
		case 'post':
			return `/admin/platform/reports?focus=${targetType}:${targetId}`;
		case 'comment':
			return `/admin/platform/reports?focus=${targetType}:${targetId}`;
		case 'blog':
			return `/admin/platform/reports?focus=${targetType}:${targetId}`;
		case 'user':
			return `/admin/platform/users#${targetId}`;
	}
}
