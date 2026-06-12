// DB queries for the self-hosted status page.
//
// Three concerns live here:
//   1. status_checks reads — currently-recorded health for the last 10 minutes
//      (used to compute the "right now" badge) and a 90-day daily summary
//      (used to draw the uptime grid on /status).
//   2. status_incidents reads — active + recent-resolved lists for the public
//      page, plus a single-incident getter for the operator UI.
//   3. status_incidents + status_incident_updates writes — declare, post
//      update, resolve. Each one is a tiny transactional helper so the
//      route handlers stay focused on validation + audit.
//
// No HTTP / auth concerns here — the API endpoints layer those on top.
import { db, schema } from './client';
import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export type StatusLevel = (typeof schema.statusLevel.enumValues)[number];
export type IncidentStatus = (typeof schema.incidentStatus.enumValues)[number];

// Public ordering used everywhere we compare two levels — "worst wins" when
// composing the overall badge. Higher number = worse.
const LEVEL_SEVERITY: Record<StatusLevel, number> = {
	operational: 0,
	degraded: 1,
	partial_outage: 2,
	major_outage: 3
};

export function worstLevel(levels: Iterable<StatusLevel>): StatusLevel {
	let worst: StatusLevel = 'operational';
	for (const l of levels) {
		if (LEVEL_SEVERITY[l] > LEVEL_SEVERITY[worst]) worst = l;
	}
	return worst;
}

export type StatusCheck = typeof schema.statusChecks.$inferSelect;
export type StatusIncident = typeof schema.statusIncidents.$inferSelect;
export type StatusIncidentUpdate = typeof schema.statusIncidentUpdates.$inferSelect;

// ─────────────────────────── probe writes ───────────────────────────

export async function recordStatusCheck(input: {
	component: string;
	level: StatusLevel;
	latencyMs?: number | null;
	error?: string | null;
}): Promise<StatusCheck> {
	const [row] = await db
		.insert(schema.statusChecks)
		.values({
			component: input.component,
			level: input.level,
			latencyMs: input.latencyMs ?? null,
			error: input.error ?? null
		})
		.returning();
	return row;
}

// ─────────────────────────── public reads ───────────────────────────

/**
 * Worst level seen across any component in the last `windowMinutes` minutes.
 * Returns 'operational' when no probes have run yet — we don't want a fresh
 * deploy to flash "major outage" just because the probe loop hasn't ticked.
 */
export async function recentWorstLevel(windowMinutes = 10): Promise<StatusLevel> {
	const since = new Date(Date.now() - windowMinutes * 60_000);
	const rows = await db
		.select({ level: schema.statusChecks.level })
		.from(schema.statusChecks)
		.where(gte(schema.statusChecks.checkedAt, since));
	return worstLevel(rows.map((r) => r.level));
}

/**
 * 90-day uptime summary — one entry per UTC day with the worst level observed.
 * Days with no probe data come back as `null` so the grid can render them as
 * "no data" rather than an artificial "operational".
 *
 * Returns oldest-first so the grid renders left-to-right chronologically.
 */
export type UptimeDay = { date: string; level: StatusLevel | null };

export async function dailyUptime(days = 90): Promise<UptimeDay[]> {
	if (days <= 0) return [];
	// Drizzle/postgres-js param binding through `sql` can choke on raw Date
	// objects in db.execute() with non-prepared statements. Pass an ISO
	// string and cast it on the server side — same semantics.
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	// `worst` per day: collapse the level enum to its severity ordinal,
	// MAX(), then map back. Postgres-side aggregation keeps the result set
	// tiny (≤90 rows) regardless of probe cardinality.
	const result = await db.execute(sql`
		SELECT
			to_char(date_trunc('day', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
			MAX(
				CASE level
					WHEN 'operational' THEN 0
					WHEN 'degraded' THEN 1
					WHEN 'partial_outage' THEN 2
					WHEN 'major_outage' THEN 3
				END
			) AS worst
		FROM status_checks
		WHERE checked_at >= ${since}::timestamptz
		GROUP BY day
	`);
	// postgres-js returns the rows as an array directly; drizzle .execute
	// passes them through as the result. Some adapter versions wrap with
	// .rows — handle both defensively.
	const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows ?? []) as Array<{
		day: string;
		worst: number;
	}>;

	const byDay = new Map<string, StatusLevel>();
	for (const r of rows) {
		const lvl: StatusLevel =
			r.worst === 0
				? 'operational'
				: r.worst === 1
					? 'degraded'
					: r.worst === 2
						? 'partial_outage'
						: 'major_outage';
		byDay.set(r.day, lvl);
	}

	// Build the full grid so missing days render as gaps. Use UTC so the grid
	// is deterministic across server timezones.
	const out: UptimeDay[] = [];
	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(today.getTime() - i * 86_400_000);
		const key = d.toISOString().slice(0, 10);
		out.push({ date: key, level: byDay.get(key) ?? null });
	}
	return out;
}

// ─────────────────────────── incident reads ───────────────────────────

export type IncidentWithLatestUpdate = StatusIncident & {
	latestUpdateBody: string | null;
};

/**
 * All incidents not yet resolved, newest first. Joined with the latest update
 * body so the public page can show "what's happening now" without an extra
 * round-trip per row.
 */
export async function listActiveIncidents(): Promise<IncidentWithLatestUpdate[]> {
	return listIncidentsWhere(ne(schema.statusIncidents.status, 'resolved'));
}

/**
 * Resolved incidents in the last `days` days, newest first.
 */
export async function listRecentResolvedIncidents(days = 30): Promise<IncidentWithLatestUpdate[]> {
	const since = new Date(Date.now() - days * 86_400_000);
	return listIncidentsWhere(
		and(eq(schema.statusIncidents.status, 'resolved'), gte(schema.statusIncidents.startedAt, since))
	);
}

async function listIncidentsWhere(where: SQL | undefined): Promise<IncidentWithLatestUpdate[]> {
	const rows = await db
		.select()
		.from(schema.statusIncidents)
		.where(where)
		.orderBy(desc(schema.statusIncidents.startedAt));
	if (rows.length === 0) return [];

	// Fetch the latest update for each incident in a single query. For our
	// expected cardinality (handful of incidents at a time) this is trivially
	// cheap; if it ever isn't, we can swap to a window function.
	const ids = rows.map((r) => r.id);
	const updates = await db
		.select({
			incidentId: schema.statusIncidentUpdates.incidentId,
			body: schema.statusIncidentUpdates.body,
			createdAt: schema.statusIncidentUpdates.createdAt
		})
		.from(schema.statusIncidentUpdates)
		.where(sql`${schema.statusIncidentUpdates.incidentId} IN ${ids}`)
		.orderBy(desc(schema.statusIncidentUpdates.createdAt));

	const latestByIncident = new Map<string, string>();
	for (const u of updates) {
		if (!latestByIncident.has(u.incidentId)) {
			latestByIncident.set(u.incidentId, u.body);
		}
	}
	return rows.map((r) => ({ ...r, latestUpdateBody: latestByIncident.get(r.id) ?? null }));
}

/**
 * Full incident view: the row itself + its timeline of updates (oldest first
 * so the UI reads top-to-bottom).
 */
export async function getIncidentWithUpdates(
	id: string
): Promise<{ incident: StatusIncident; updates: StatusIncidentUpdate[] } | null> {
	const [incident] = await db
		.select()
		.from(schema.statusIncidents)
		.where(eq(schema.statusIncidents.id, id))
		.limit(1);
	if (!incident) return null;
	const updates = await db
		.select()
		.from(schema.statusIncidentUpdates)
		.where(eq(schema.statusIncidentUpdates.incidentId, id))
		.orderBy(schema.statusIncidentUpdates.createdAt);
	return { incident, updates };
}

/**
 * Listing for the operator dashboard. `filter` switches between active-only
 * and everything; both ordered newest-first.
 */
export async function listIncidentsForOperator(
	filter: 'active' | 'all' = 'active'
): Promise<StatusIncident[]> {
	const q = db.select().from(schema.statusIncidents).orderBy(desc(schema.statusIncidents.startedAt));
	if (filter === 'active') {
		return q.where(ne(schema.statusIncidents.status, 'resolved'));
	}
	return q;
}

// ─────────────────────────── incident writes ───────────────────────────

export async function declareIncident(input: {
	title: string;
	level: StatusLevel;
	declaredByUserId: string;
}): Promise<StatusIncident> {
	const [row] = await db
		.insert(schema.statusIncidents)
		.values({
			title: input.title,
			level: input.level,
			status: 'investigating',
			declaredByUserId: input.declaredByUserId
		})
		.returning();
	return row;
}

export async function postIncidentUpdate(input: {
	incidentId: string;
	status: IncidentStatus;
	body: string;
	postedByUserId: string;
}): Promise<{ update: StatusIncidentUpdate; incident: StatusIncident } | null> {
	return db.transaction(async (tx) => {
		// Confirm the incident exists before writing — otherwise we'd happily
		// insert an orphan update if the FK was ever loosened.
		const [incident] = await tx
			.select()
			.from(schema.statusIncidents)
			.where(eq(schema.statusIncidents.id, input.incidentId))
			.limit(1);
		if (!incident) return null;

		const [update] = await tx
			.insert(schema.statusIncidentUpdates)
			.values({
				incidentId: input.incidentId,
				status: input.status,
				body: input.body,
				postedByUserId: input.postedByUserId
			})
			.returning();

		const toSet: Record<string, unknown> = { status: input.status };
		// `monitoring` / `identified` / `investigating` all leave resolvedAt
		// untouched. `resolved` should ideally go through resolveIncident(),
		// but if an operator posts a `resolved`-status update directly we
		// honor it here too.
		if (input.status === 'resolved' && !incident.resolvedAt) {
			toSet.resolvedAt = new Date();
		}
		const [updatedIncident] = await tx
			.update(schema.statusIncidents)
			.set(toSet)
			.where(eq(schema.statusIncidents.id, input.incidentId))
			.returning();

		return { update, incident: updatedIncident };
	});
}

export async function resolveIncident(input: {
	incidentId: string;
	postedByUserId: string;
	body?: string | null;
}): Promise<{ update: StatusIncidentUpdate; incident: StatusIncident } | null> {
	return db.transaction(async (tx) => {
		const [incident] = await tx
			.select()
			.from(schema.statusIncidents)
			.where(eq(schema.statusIncidents.id, input.incidentId))
			.limit(1);
		if (!incident) return null;

		const now = new Date();
		const [updatedIncident] = await tx
			.update(schema.statusIncidents)
			.set({ status: 'resolved', resolvedAt: incident.resolvedAt ?? now })
			.where(eq(schema.statusIncidents.id, input.incidentId))
			.returning();

		const [update] = await tx
			.insert(schema.statusIncidentUpdates)
			.values({
				incidentId: input.incidentId,
				status: 'resolved',
				body: input.body && input.body.trim() ? input.body : 'Incident resolved.',
				postedByUserId: input.postedByUserId
			})
			.returning();

		return { update, incident: updatedIncident };
	});
}

// ─────────────────────────── probe helpers ───────────────────────────

/**
 * Classify a single probe result into a status level. Lifted out of the
 * probe loop so tests can drive it with synthetic latencies / errors without
 * spinning up an HTTP server.
 */
export function classifyProbe(opts: {
	status: number | null;
	latencyMs: number;
	error: string | null;
}): StatusLevel {
	if (opts.error || opts.status === null || opts.status < 200 || opts.status >= 300) {
		return 'major_outage';
	}
	if (opts.latencyMs > 2_000) return 'partial_outage';
	if (opts.latencyMs >= 500) return 'degraded';
	return 'operational';
}
