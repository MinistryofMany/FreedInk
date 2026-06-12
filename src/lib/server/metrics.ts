// Platform metrics helpers — shared between the operator dashboard and the
// /metrics Prometheus endpoint. Every count is a fresh SQL query (no in-memory
// state) so a server restart never lies. Cardinality is intentionally tiny:
// status labels come from fixed pgEnums, audit events from the audit_event
// enum. No unbounded user/blog labels — those would blow up Prometheus.

import { db, schema } from '$lib/db/client';
import { sql, and, eq, gt, gte, isNotNull } from 'drizzle-orm';

export type MetricType = 'gauge' | 'counter' | 'histogram';

export type MetricSample = {
	// Optional labels for this individual sample (added on top of the metric's
	// shared labels, if any). Values are escaped at render time.
	labels?: Record<string, string>;
	// Required for gauge/counter. Ignored by histogram, which uses
	// buckets/sum/count instead — pass 0 to satisfy the type.
	value?: number;
	// For histograms: a non-empty buckets array (le → cumulative count). When
	// set, the renderer emits _bucket / _sum / _count lines instead of the
	// plain sample line.
	buckets?: Array<{ le: number | '+Inf'; count: number }>;
	sum?: number;
	count?: number;
};

export type Metric = {
	name: string;
	help: string;
	type: MetricType;
	samples: MetricSample[];
};

// ────────────────────────── pure gauge helpers ──────────────────────────
//
// Each helper is a thin wrapper around `count(*)` so they're cheap (<10 ms
// on small tables) and reusable from both the dashboard `load` and the
// /metrics endpoint. They're deliberately separate functions rather than a
// single mega-query: callers may want only a subset (the dashboard skips
// the audit-events-24h breakdown, /metrics doesn't need the sparklines).

export async function countUsersTotal(): Promise<number> {
	const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
	return row?.n ?? 0;
}

export async function countUsersSuspended(): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.users)
		.where(isNotNull(schema.users.suspendedAt));
	return row?.n ?? 0;
}

// Active = at least one session with last_seen_at within `since`. Defaults
// to the last 7 days. The session row is unique per (user, device), so
// distinct user_id avoids double-counting a user with many devices.
export async function countActiveUsers(sinceDays = 7): Promise<number> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const [row] = await db
		.select({ n: sql<number>`count(distinct ${schema.sessions.userId})::int` })
		.from(schema.sessions)
		.where(gte(schema.sessions.lastSeenAt, since));
	return row?.n ?? 0;
}

export async function countBlogs(opts: { archived: boolean }): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.blogs)
		.where(
			opts.archived ? isNotNull(schema.blogs.archivedAt) : sql`${schema.blogs.archivedAt} IS NULL`
		);
	return row?.n ?? 0;
}

// Group posts by status — one count for every value of the post_status enum.
// We initialize every status to 0 so a freshly-installed instance still
// exposes the full label set (otherwise Prometheus alert rules that diff
// on `published` would never see the metric and fire spuriously).
export async function countPostsByStatus(): Promise<Record<string, number>> {
	const rows = await db
		.select({
			status: schema.blogPosts.status,
			n: sql<number>`count(*)::int`
		})
		.from(schema.blogPosts)
		.groupBy(schema.blogPosts.status);
	const out: Record<string, number> = {
		draft: 0,
		under_review: 0,
		published: 0,
		rejected: 0
	};
	for (const r of rows) out[r.status] = r.n;
	return out;
}

// Published *versions* (excluding soft-deleted). Distinct from
// blog_posts.status='published' — the latter is the post pointer, the former
// is the live, undeleted version. Operators look at this number to know how
// much content is actually readable on the platform.
export async function countPublishedPostVersions(): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.blogPostVersions)
		.where(
			and(
				eq(schema.blogPostVersions.status, 'published'),
				sql`${schema.blogPostVersions.deletedAt} IS NULL`
			)
		);
	return row?.n ?? 0;
}

export async function countCommentsTotal(): Promise<number> {
	const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.postComments);
	return row?.n ?? 0;
}

export async function countCommentsSince(sinceDays: number): Promise<number> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.postComments)
		.where(gte(schema.postComments.createdAt, since));
	return row?.n ?? 0;
}

export async function countReviewsByVote(): Promise<{ approve: number; reject: number }> {
	const rows = await db
		.select({ vote: schema.postReviews.vote, n: sql<number>`count(*)::int` })
		.from(schema.postReviews)
		.groupBy(schema.postReviews.vote);
	const out = { approve: 0, reject: 0 };
	for (const r of rows) {
		if (r.vote === 'approve') out.approve = r.n;
		else if (r.vote === 'reject') out.reject = r.n;
	}
	return out;
}

export async function countReviewsSince(sinceDays: number): Promise<number> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.postReviews)
		.where(gte(schema.postReviews.createdAt, since));
	return row?.n ?? 0;
}

export async function countAbuseReportsOpen(): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.abuseReports)
		.where(eq(schema.abuseReports.status, 'open'));
	return row?.n ?? 0;
}

export async function countActiveSessions(): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.sessions)
		.where(gt(schema.sessions.expiresAt, sql`now()`));
	return row?.n ?? 0;
}

// "Rate limit blocks": rows whose count has already exceeded a hypothetical
// limit. We don't have a per-key limit column, so this is a rough signal —
// rows where count > 100 (the highest limit in rate-limit.ts) within the
// active window. Operators use this as an "are we under attack?" sniff test,
// not an exact number.
export async function countRateLimitBlocks24h(): Promise<number> {
	const since = new Date(Date.now() - 86_400_000);
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.rateLimits)
		.where(and(gte(schema.rateLimits.windowStart, since), sql`${schema.rateLimits.count} > 100`));
	return row?.n ?? 0;
}

// 24h breakdown of audit events by type. Bounded cardinality: the audit_event
// enum has ~40 values, all known at compile time. The result is keyed by
// event name so callers can fold it into the metrics list deterministically.
export async function countAuditEvents24h(): Promise<Record<string, number>> {
	const since = new Date(Date.now() - 86_400_000);
	const rows = await db
		.select({ event: schema.auditLog.event, n: sql<number>`count(*)::int` })
		.from(schema.auditLog)
		.where(gte(schema.auditLog.createdAt, since))
		.groupBy(schema.auditLog.event);
	const out: Record<string, number> = {};
	for (const r of rows) out[r.event] = r.n;
	return out;
}

// ────────────────────────── 30-day sparkline buckets ──────────────────────────

export type DailyBucket = { date: string; count: number };

// Day-bucketed counts over a rolling window for a single timestamp column.
// One round trip per series, executed with a generate_series so days with no
// rows still show as `count: 0` (otherwise the sparkline would skip them).
// `column` is composed into a raw SQL fragment — caller passes a Drizzle
// PgColumn, NOT user input, so injection is not a concern.
async function bucketByDay(
	table: ReturnType<typeof sql>,
	column: ReturnType<typeof sql>,
	days: number
): Promise<DailyBucket[]> {
	const rows = await db.execute<{ d: string; n: number }>(sql`
		WITH days AS (
			SELECT generate_series(
				date_trunc('day', now()) - (${days - 1}::int * interval '1 day'),
				date_trunc('day', now()),
				interval '1 day'
			)::date AS d
		)
		SELECT
			to_char(days.d, 'YYYY-MM-DD') AS d,
			coalesce(count(t.*), 0)::int AS n
		FROM days
		LEFT JOIN ${table} t ON date_trunc('day', t.${column}) = days.d
		GROUP BY days.d
		ORDER BY days.d ASC
	`);
	return Array.from(rows).map((r) => ({ date: r.d, count: Number(r.n) }));
}

export async function dailyNewUsers(days = 30): Promise<DailyBucket[]> {
	return bucketByDay(sql.raw('users'), sql.raw('created_at'), days);
}

export async function dailyNewPosts(days = 30): Promise<DailyBucket[]> {
	return bucketByDay(sql.raw('blog_posts'), sql.raw('created_at'), days);
}

export async function dailyNewComments(days = 30): Promise<DailyBucket[]> {
	return bucketByDay(sql.raw('post_comments'), sql.raw('created_at'), days);
}

// ────────────────────────── exposition format renderer ──────────────────────────

// Per the Prometheus exposition format spec (0.0.4):
//   - label values: escape `\` → `\\`, `"` → `\"`, newline → `\n`
//   - help text:    escape `\` → `\\`, newline → `\n`
// Order of lines for a metric:
//   # HELP <name> <help>
//   # TYPE <name> <type>
//   <samples...>
// We do not emit timestamps — Prometheus stamps scrape time itself.

export function escapeLabelValue(v: string): string {
	return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function escapeHelp(v: string): string {
	return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function renderLabels(labels: Record<string, string> | undefined): string {
	if (!labels) return '';
	const parts: string[] = [];
	// Sort keys for deterministic output — easier to diff scrapes and assert
	// in tests. Prometheus itself doesn't care about label order.
	for (const k of Object.keys(labels).sort()) {
		parts.push(`${k}="${escapeLabelValue(labels[k])}"`);
	}
	return parts.length ? `{${parts.join(',')}}` : '';
}

function renderValue(v: number): string {
	if (Number.isNaN(v)) return 'NaN';
	if (v === Number.POSITIVE_INFINITY) return '+Inf';
	if (v === Number.NEGATIVE_INFINITY) return '-Inf';
	return String(v);
}

function renderHistogramSample(name: string, s: MetricSample): string {
	const baseLabels = s.labels ?? {};
	const lines: string[] = [];
	for (const b of s.buckets ?? []) {
		const labels = { ...baseLabels, le: b.le === '+Inf' ? '+Inf' : String(b.le) };
		lines.push(`${name}_bucket${renderLabels(labels)} ${renderValue(b.count)}`);
	}
	lines.push(`${name}_sum${renderLabels(baseLabels)} ${renderValue(s.sum ?? 0)}`);
	lines.push(`${name}_count${renderLabels(baseLabels)} ${renderValue(s.count ?? 0)}`);
	return lines.join('\n');
}

export function renderPrometheus(metrics: Metric[]): string {
	const out: string[] = [];
	const validTypes: MetricType[] = ['gauge', 'counter', 'histogram'];
	for (const m of metrics) {
		if (!validTypes.includes(m.type)) {
			throw new Error(`renderPrometheus: unknown metric type "${m.type}" for "${m.name}"`);
		}
		out.push(`# HELP ${m.name} ${escapeHelp(m.help)}`);
		out.push(`# TYPE ${m.name} ${m.type}`);
		for (const s of m.samples) {
			if (m.type === 'histogram') {
				out.push(renderHistogramSample(m.name, s));
			} else {
				out.push(`${m.name}${renderLabels(s.labels)} ${renderValue(s.value ?? 0)}`);
			}
		}
	}
	// Trailing newline — Prometheus accepts both, but its own clients always
	// emit one, so we match.
	return out.join('\n') + '\n';
}

// ────────────────────────── DB latency histogram ──────────────────────────
//
// One probe: time how long a trivial `SELECT 1` takes. This is enough to
// detect a DB that has gone slow without instrumenting every query. We
// report it as a histogram with three fixed buckets (5ms / 50ms / +Inf):
// the absolute boundaries don't matter much in a single-probe-per-scrape
// model — Prometheus rate() won't make sense on a 1-sample window — but the
// histogram type is what observability stacks expect to see for latency,
// and it composes nicely with Grafana panels.

export async function probeDbLatency(): Promise<{ seconds: number }> {
	const t0 = process.hrtime.bigint();
	await db.execute(sql`SELECT 1`);
	const ns = Number(process.hrtime.bigint() - t0);
	return { seconds: ns / 1e9 };
}

export function buildDbLatencyHistogram(seconds: number): Metric {
	const buckets: Array<{ le: number | '+Inf'; count: number }> = [
		{ le: 0.005, count: seconds <= 0.005 ? 1 : 0 },
		{ le: 0.05, count: seconds <= 0.05 ? 1 : 0 },
		{ le: '+Inf', count: 1 }
	];
	return {
		name: 'freedink_db_query_duration_seconds',
		help: 'Latency of a representative SELECT 1 probe against the primary database.',
		type: 'histogram',
		samples: [{ buckets, sum: seconds, count: 1 }]
	};
}

// ────────────────────────── one-stop metric collection ──────────────────────────

// Pulls every gauge in parallel and assembles the Metric[] list the
// /metrics endpoint serializes. Lives here (not in the route) so the
// dashboard could reuse the same shape if it ever needs to render the raw
// exposition output (e.g. a "preview your scrape" link).
export async function collectAllMetrics(): Promise<Metric[]> {
	const [
		usersTotal,
		usersSuspended,
		blogsActive,
		blogsArchived,
		postsByStatus,
		commentsTotal,
		reviewsByVote,
		abuseOpen,
		activeSessions,
		rateLimitBlocks,
		auditEvents,
		dbProbe
	] = await Promise.all([
		countUsersTotal(),
		countUsersSuspended(),
		countBlogs({ archived: false }),
		countBlogs({ archived: true }),
		countPostsByStatus(),
		countCommentsTotal(),
		countReviewsByVote(),
		countAbuseReportsOpen(),
		countActiveSessions(),
		countRateLimitBlocks24h(),
		countAuditEvents24h(),
		probeDbLatency()
	]);

	const metrics: Metric[] = [
		{
			name: 'freedink_users_total',
			help: 'Total registered users.',
			type: 'gauge',
			samples: [{ value: usersTotal }]
		},
		{
			name: 'freedink_users_suspended',
			help: 'Users currently flagged as suspended by a platform operator.',
			type: 'gauge',
			samples: [{ value: usersSuspended }]
		},
		{
			name: 'freedink_blogs_total',
			help: 'Blogs broken down by archived flag.',
			type: 'gauge',
			samples: [
				{ labels: { archived: 'false' }, value: blogsActive },
				{ labels: { archived: 'true' }, value: blogsArchived }
			]
		},
		{
			name: 'freedink_posts_total',
			help: 'Posts broken down by status (one sample per post_status enum value).',
			type: 'gauge',
			samples: ['draft', 'under_review', 'published', 'rejected'].map((s) => ({
				labels: { status: s },
				value: postsByStatus[s] ?? 0
			}))
		},
		{
			name: 'freedink_comments_total',
			help: 'Total comments posted (includes soft-deleted).',
			type: 'gauge',
			samples: [{ value: commentsTotal }]
		},
		{
			name: 'freedink_reviews_total',
			help: 'Reviews cast, broken down by vote. Reported as a gauge of cumulative count.',
			type: 'counter',
			samples: [
				{ labels: { vote: 'approve' }, value: reviewsByVote.approve },
				{ labels: { vote: 'reject' }, value: reviewsByVote.reject }
			]
		},
		{
			name: 'freedink_abuse_reports_open',
			help: 'Abuse reports currently in the "open" state.',
			type: 'gauge',
			samples: [{ value: abuseOpen }]
		},
		{
			name: 'freedink_active_sessions',
			help: 'Sessions whose expires_at is still in the future.',
			type: 'gauge',
			samples: [{ value: activeSessions }]
		},
		{
			name: 'freedink_rate_limit_blocks_24h',
			help: 'Rate-limit rows with count > 100 in the last 24h (rough abuse signal).',
			type: 'gauge',
			samples: [{ value: rateLimitBlocks }]
		}
	];

	// Audit events: one sample per distinct event in the last 24h. We omit
	// zero-count events to keep the scrape compact; alert rules that need
	// "rate of events that never happened" can use `absent()`.
	const auditKeys = Object.keys(auditEvents).sort();
	if (auditKeys.length > 0) {
		metrics.push({
			name: 'freedink_audit_events_24h',
			help: 'Audit-log events emitted in the last 24h, grouped by event type.',
			type: 'counter',
			samples: auditKeys.map((k) => ({ labels: { event: k }, value: auditEvents[k] }))
		});
	} else {
		metrics.push({
			name: 'freedink_audit_events_24h',
			help: 'Audit-log events emitted in the last 24h, grouped by event type.',
			type: 'counter',
			samples: []
		});
	}

	metrics.push(buildDbLatencyHistogram(dbProbe.seconds));
	return metrics;
}
