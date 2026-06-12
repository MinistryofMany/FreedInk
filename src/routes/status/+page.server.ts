// Public status page. SSR-only — no client store, no JS deps. Sets a 30s
// public cache header so a swarm of refreshes stays cheap.
//
// Overall level = worst of:
//   - last 10 minutes of probes for any component
//   - any active (non-resolved) incident's declared level
// This way an operator-declared "partial_outage" beats a noisy-clean probe
// signal, and vice versa.
import type { PageServerLoad } from './$types';
import {
	dailyUptime,
	listActiveIncidents,
	listRecentResolvedIncidents,
	recentWorstLevel,
	worstLevel
} from '$lib/db/status';

export const load: PageServerLoad = async ({ setHeaders }) => {
	const [probeLevel, activeIncidents, recentResolved, grid] = await Promise.all([
		recentWorstLevel(10),
		listActiveIncidents(),
		listRecentResolvedIncidents(30),
		dailyUptime(90)
	]);

	const overall = worstLevel([probeLevel, ...activeIncidents.map((i) => i.level)]);

	// Public, anonymous, idempotent — cache for 30s at the edge / browser.
	// `/healthz` itself is no-store; this page rolls up the data and is fine
	// to be slightly stale because it's purely informational.
	setHeaders({
		'cache-control': 'public, max-age=30'
	});

	return {
		overall,
		probeLevel,
		activeIncidents,
		recentResolved,
		grid,
		generatedAt: new Date().toISOString()
	};
};
