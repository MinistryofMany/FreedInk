<script lang="ts">
	import type { PageData } from './$types';
	import type { StatusLevel } from '$lib/db/status';
	export let data: PageData;

	$: ({ overall, activeIncidents, recentResolved, grid, generatedAt } = data);

	const LABELS: Record<StatusLevel, string> = {
		operational: 'All systems operational',
		degraded: 'Degraded performance',
		partial_outage: 'Partial outage',
		major_outage: 'Major outage'
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

<section class="status-page">
	<header class="overall level-{overall}">
		<div class="dot" aria-hidden="true"></div>
		<h1>{LABELS[overall]}</h1>
	</header>

	<section class="uptime" aria-label="90-day uptime history">
		<h2>Last 90 days</h2>
		<div class="grid" role="img" aria-label="Daily uptime grid">
			{#each grid as cell (cell.date)}
				<span
					class="cell level-{cell.level ?? 'unknown'}"
					title="{cell.date}: {levelLabel(cell.level)}"
				></span>
			{/each}
		</div>
		<div class="legend">
			<span class="swatch level-operational"></span> Operational
			<span class="swatch level-degraded"></span> Degraded
			<span class="swatch level-partial_outage"></span> Partial outage
			<span class="swatch level-major_outage"></span> Major outage
			<span class="swatch level-unknown"></span> No data
		</div>
	</section>

	<section aria-label="Active incidents">
		<h2>Active incidents</h2>
		{#if activeIncidents.length === 0}
			<p class="ok">No active incidents.</p>
		{:else}
			<ul class="incidents">
				{#each activeIncidents as inc (inc.id)}
					<li class="incident level-{inc.level}">
						<header>
							<span class="badge level-{inc.level}">{LABELS[inc.level]}</span>
							<strong>{inc.title}</strong>
						</header>
						<p class="meta">
							Status: <code>{inc.status}</code> · Started {fmt(inc.startedAt)}
						</p>
						{#if inc.latestUpdateBody}
							<p class="update">{inc.latestUpdateBody}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-label="Recent incidents">
		<h2>Recent incidents (last 30 days)</h2>
		{#if recentResolved.length === 0}
			<p class="ok">No incidents reported in the last 30 days.</p>
		{:else}
			<ul class="incidents">
				{#each recentResolved as inc (inc.id)}
					<li class="incident resolved">
						<header>
							<span class="badge level-{inc.level}">{LABELS[inc.level]}</span>
							<strong>{inc.title}</strong>
						</header>
						<p class="meta">
							Resolved {inc.resolvedAt ? fmt(inc.resolvedAt) : '—'} · Started {fmt(inc.startedAt)}
						</p>
						{#if inc.latestUpdateBody}
							<p class="update">{inc.latestUpdateBody}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<footer class="generated">
		Updated {fmt(generatedAt)}
	</footer>
</section>

<style>
	.status-page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1rem;
	}
	.overall {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1.25rem 1rem;
		border-radius: 0.5rem;
		margin-bottom: 1.5rem;
		border: 1px solid var(--color-border, #ddd);
	}
	.overall .dot {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		flex: 0 0 1rem;
	}
	.overall h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	.overall.level-operational {
		background: #e6f7e8;
		border-color: #2e7d32;
	}
	.overall.level-operational .dot {
		background: #2e7d32;
	}
	.overall.level-degraded {
		background: #fff8e1;
		border-color: #b08900;
	}
	.overall.level-degraded .dot {
		background: #b08900;
	}
	.overall.level-partial_outage {
		background: #ffe9d6;
		border-color: #d65a00;
	}
	.overall.level-partial_outage .dot {
		background: #d65a00;
	}
	.overall.level-major_outage {
		background: #fde2e2;
		border-color: #c62828;
	}
	.overall.level-major_outage .dot {
		background: #c62828;
	}
	.uptime {
		margin-bottom: 2rem;
	}
	.uptime h2 {
		font-size: 1.05rem;
		margin: 0 0 0.5rem;
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
		background: #ccc;
	}
	.cell.level-operational {
		background: #2e7d32;
	}
	.cell.level-degraded {
		background: #b08900;
	}
	.cell.level-partial_outage {
		background: #d65a00;
	}
	.cell.level-major_outage {
		background: #c62828;
	}
	.cell.level-unknown {
		background: #e6e6e6;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		font-size: 0.8rem;
		margin-top: 0.75rem;
		color: var(--color-text, #333);
	}
	.swatch {
		display: inline-block;
		width: 0.8rem;
		height: 0.8rem;
		margin-right: 0.25rem;
		vertical-align: -1px;
		border-radius: 2px;
	}
	.swatch.level-operational {
		background: #2e7d32;
	}
	.swatch.level-degraded {
		background: #b08900;
	}
	.swatch.level-partial_outage {
		background: #d65a00;
	}
	.swatch.level-major_outage {
		background: #c62828;
	}
	.swatch.level-unknown {
		background: #e6e6e6;
	}
	h2 {
		font-size: 1.05rem;
		margin: 1.5rem 0 0.5rem;
	}
	.ok {
		color: #2e7d32;
	}
	.incidents {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.incident {
		border: 1px solid var(--color-border, #ddd);
		border-radius: 0.4rem;
		padding: 0.75rem 1rem;
	}
	.incident header {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.25rem;
	}
	.badge {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		color: #fff;
	}
	.badge.level-operational {
		background: #2e7d32;
	}
	.badge.level-degraded {
		background: #b08900;
	}
	.badge.level-partial_outage {
		background: #d65a00;
	}
	.badge.level-major_outage {
		background: #c62828;
	}
	.meta {
		font-size: 0.85rem;
		color: #555;
		margin: 0.1rem 0 0.25rem;
	}
	.update {
		margin: 0.25rem 0 0;
		white-space: pre-wrap;
	}
	.generated {
		margin-top: 2rem;
		text-align: right;
		font-size: 0.8rem;
		color: #777;
	}
</style>
