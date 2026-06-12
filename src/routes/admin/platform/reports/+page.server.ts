// Moderation queue: list abuse reports with status filter + paginated.
// Operator-only (via the +layout.server.ts gate). Resolve/dismiss actions
// post to the dedicated /api/platform/reports/[id]/{resolve,dismiss}
// endpoints from the client; we expose the report rows + tab counts here.
import type { PageServerLoad } from './$types';
import { listReports, type ReportStatus, targetLinkFor } from '$lib/db/reports';
import { db, schema } from '$lib/db/client';
import { eq, sql } from 'drizzle-orm';

const PAGE_SIZE = 25;
const STATUSES: ReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('status') ?? 'open';
	const status: ReportStatus = (STATUSES as string[]).includes(requested)
		? (requested as ReportStatus)
		: 'open';

	const pageParam = Number(url.searchParams.get('page') ?? '1');
	const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
	const offset = (page - 1) * PAGE_SIZE;

	const { items, total } = await listReports({ status, limit: PAGE_SIZE, offset });
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	// Counts per status for the filter tabs. One small query per status —
	// fine at our cardinality; if reports explodes to 100k+ we can move
	// this to a single grouped query.
	const counts: Record<ReportStatus, number> = {
		open: 0,
		reviewing: 0,
		resolved: 0,
		dismissed: 0
	};
	for (const s of STATUSES) {
		const [row] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(schema.abuseReports)
			.where(eq(schema.abuseReports.status, s));
		counts[s] = row?.n ?? 0;
	}

	const enriched = items.map((r) => ({
		...r,
		targetLink: targetLinkFor(r.targetType, r.targetId)
	}));

	return {
		reports: enriched,
		status,
		page,
		totalPages,
		total,
		counts
	};
};
