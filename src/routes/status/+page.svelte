<script lang="ts">
	import type { PageData } from './$types';
	import type { StatusLevel } from '$lib/db/status';
	import { Badge, Card, Kicker } from '$lib/components/ui';
	export let data: PageData;

	$: ({ overall, activeIncidents, recentResolved, grid, generatedAt } = data);

	const LABELS: Record<StatusLevel, string> = {
		operational: 'All systems operational',
		degraded: 'Degraded performance',
		partial_outage: 'Partial outage',
		major_outage: 'Major outage'
	};

	const BADGE_TONE: Record<StatusLevel, 'success' | 'warning' | 'danger'> = {
		operational: 'success',
		degraded: 'warning',
		partial_outage: 'danger',
		major_outage: 'danger'
	};

	function levelLabel(level: StatusLevel | null): string {
		return level ? LABELS[level] : 'No data';
	}

	function fmt(d: Date | string): string {
		const t = typeof d === 'string' ? new Date(d) : d;
		return t.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<svelte:head>
	<title>Status — Freed Ink</title>
	<meta name="description" content="Current platform status and recent incidents." />
</svelte:head>

<div class="status-page">
	<header class="status-header">
		<Kicker>Status</Kicker>
		<Card>
			<div class="overall-inner">
				<span class="overall-dot level-{overall}" aria-hidden="true"></span>
				<div class="overall-text">
					<Badge tone={BADGE_TONE[overall]}>{overall.replace('_', ' ')}</Badge>
					<h1 class="overall-heading">{LABELS[overall]}</h1>
				</div>
			</div>
		</Card>
	</header>

	<section class="uptime" aria-label="90-day uptime history">
		<h2 class="section-heading">Last 90 days</h2>
		<div class="grid" role="img" aria-label="Daily uptime grid">
			{#each grid as cell (cell.date)}
				<span
					class="cell level-{cell.level ?? 'unknown'}"
					title="{cell.date}: {levelLabel(cell.level)}"
				></span>
			{/each}
		</div>
		<div class="legend">
			<span class="swatch level-operational" aria-hidden="true"></span>
			<span>Operational</span>
			<span class="swatch level-degraded" aria-hidden="true"></span>
			<span>Degraded</span>
			<span class="swatch level-partial_outage" aria-hidden="true"></span>
			<span>Partial outage</span>
			<span class="swatch level-major_outage" aria-hidden="true"></span>
			<span>Major outage</span>
			<span class="swatch level-unknown" aria-hidden="true"></span>
			<span>No data</span>
		</div>
	</section>

	<section aria-label="Active incidents">
		<h2 class="section-heading">Active incidents</h2>
		{#if activeIncidents.length === 0}
			<p class="ok">No active incidents.</p>
		{:else}
			<ul class="incidents" role="list">
				{#each activeIncidents as inc (inc.id)}
					<li>
						<Card>
							<div class="incident-inner">
								<div class="incident-header">
									<Badge tone={BADGE_TONE[inc.level]}>{LABELS[inc.level]}</Badge>
									<strong class="incident-title">{inc.title}</strong>
								</div>
								<p class="meta">
									Status: <code>{inc.status}</code> · Started {fmt(inc.startedAt)}
								</p>
								{#if inc.latestUpdateBody}
									<p class="update">{inc.latestUpdateBody}</p>
								{/if}
							</div>
						</Card>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-label="Recent incidents">
		<h2 class="section-heading">Recent incidents (last 30 days)</h2>
		{#if recentResolved.length === 0}
			<p class="ok">No incidents reported in the last 30 days.</p>
		{:else}
			<ul class="incidents" role="list">
				{#each recentResolved as inc (inc.id)}
					<li>
						<Card>
							<div class="incident-inner">
								<div class="incident-header">
									<Badge tone="neutral">{LABELS[inc.level]}</Badge>
									<strong class="incident-title">{inc.title}</strong>
								</div>
								<p class="meta">
									Resolved {inc.resolvedAt ? fmt(inc.resolvedAt) : '—'} · Started {fmt(
										inc.startedAt
									)}
								</p>
								{#if inc.latestUpdateBody}
									<p class="update">{inc.latestUpdateBody}</p>
								{/if}
							</div>
						</Card>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<footer class="generated">
		Updated {fmt(generatedAt)}
	</footer>
</div>

<style>
	.status-page {
		max-width: 60rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.status-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.overall-inner {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.overall-dot {
		flex: 0 0 1rem;
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
	}

	.overall-dot.level-operational {
		background: var(--color-accent);
	}

	.overall-dot.level-degraded {
		background: var(--color-warning);
	}

	.overall-dot.level-partial_outage {
		background: var(--color-danger);
	}

	.overall-dot.level-major_outage {
		background: var(--color-danger);
	}

	.overall-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.overall-heading {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		margin: 0;
		line-height: 1.2;
	}

	.section-heading {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-4);
	}

	.uptime {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(90, 1fr);
		gap: 2px;
		min-height: 2.5rem;
	}

	.cell {
		height: 2.5rem;
		border-radius: 2px;
	}

	.cell.level-operational {
		background: var(--color-accent);
	}

	.cell.level-degraded {
		background: var(--color-warning);
	}

	.cell.level-partial_outage {
		background: var(--color-danger);
		opacity: 0.7;
	}

	.cell.level-major_outage {
		background: var(--color-danger);
	}

	.cell.level-unknown {
		background: var(--color-border);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 2px;
		vertical-align: -1px;
	}

	.swatch.level-operational {
		background: var(--color-accent);
	}

	.swatch.level-degraded {
		background: var(--color-warning);
	}

	.swatch.level-partial_outage {
		background: var(--color-danger);
		opacity: 0.7;
	}

	.swatch.level-major_outage {
		background: var(--color-danger);
	}

	.swatch.level-unknown {
		background: var(--color-border);
	}

	.incidents {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.incident-inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.incident-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.incident-title {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		color: var(--color-text);
		font-weight: 600;
	}

	.meta {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin: 0;
	}

	.update {
		font-family: var(--font-standfirst);
		font-size: var(--text-sm);
		color: var(--color-text);
		margin: 0;
		white-space: pre-wrap;
	}

	.ok {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-accent);
		margin: 0;
	}

	.generated {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		text-align: right;
	}
</style>
