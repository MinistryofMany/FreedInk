<script lang="ts">
	import { Card, Button, Badge, Kicker, EmptyState } from '$lib/components/ui';

	export let data;

	function statusTone(s: string): 'warning' | 'neutral' | 'success' | 'danger' {
		if (s === 'open') return 'warning';
		if (s === 'reviewing') return 'neutral';
		if (s === 'resolved') return 'success';
		return 'danger';
	}
</script>

<svelte:head>
	<title>Reports — Operator</title>
</svelte:head>

<div class="wrap">
	<header class="head">
		<Kicker>Moderation</Kicker>
		<h1 class="heading">Reports queue</h1>
		<p class="note">
			Abuse reports across every blog. Open a target to hide or restore it from that blog's
			moderation page.
		</p>
		<nav class="filters" aria-label="Filter by status">
			{#each data.statuses as s (s)}
				<Button
					href="/admin/ops/reports?status={s}"
					variant={data.status === s ? 'primary' : 'ghost'}
					size="sm"
				>
					{s}
				</Button>
			{/each}
		</nav>
	</header>

	{#if data.reports.length === 0}
		<EmptyState title="No {data.status} reports." />
	{:else}
		<ul class="report-list">
			{#each data.reports as r (r.id)}
				<li>
					<Card padding="md" class="report-card">
						<div class="report-top">
							<div class="report-tags">
								<Badge tone={statusTone(r.status)}>{r.status}</Badge>
								<Badge tone="neutral">{r.targetType}</Badge>
								<span class="reason">{r.reason}</span>
							</div>
							<span class="date">{new Date(r.createdAt).toLocaleString()}</span>
						</div>
						{#if r.details}<p class="details">{r.details}</p>{/if}
						<div class="report-meta">
							<span class="muted">
								Reporter: {r.reporterUsername ?? 'anonymous'}
							</span>
							<span class="muted target-id">Target: {r.targetId}</span>
						</div>
						{#if r.moderationLink}
							<div class="report-actions">
								<Button href={r.moderationLink} variant="ghost" size="sm">Open target</Button>
							</div>
						{/if}
					</Card>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.heading {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}
	.note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
		max-width: 70ch;
	}
	.filters {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.report-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.report-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.report-tags {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.reason {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}
	.date {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.details {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		margin: var(--space-2) 0 0;
		white-space: pre-wrap;
	}
	.report-meta {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}
	.muted {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.target-id {
		word-break: break-all;
	}
	.report-actions {
		margin-top: var(--space-2);
	}
</style>
