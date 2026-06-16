<script lang="ts">
	import { goto } from '$app/navigation';
	import { Table, Card, Field, Button, Badge, EmptyState, Kicker } from '$lib/components/ui';
	import type { PageData } from './$types';
	import type { StatusLevel } from '$lib/db/status';
	export let data: PageData;
	$: ({ incidents, filter } = data);

	const LEVELS: StatusLevel[] = ['degraded', 'partial_outage', 'major_outage', 'operational'];

	let showDeclare = false;
	let title = '';
	let level: StatusLevel = 'partial_outage';
	let declaring = false;
	let declareError = '';

	async function declare() {
		declaring = true;
		declareError = '';
		try {
			const res = await fetch('/api/platform/incidents', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title, level })
			});
			if (!res.ok) {
				declareError = (await res.text()) || `declare failed (${res.status})`;
				return;
			}
			const { id } = await res.json();
			await goto(`/admin/platform/incidents/${id}`);
		} finally {
			declaring = false;
		}
	}

	function fmt(d: Date | string): string {
		const t = typeof d === 'string' ? new Date(d) : d;
		return t.toLocaleString();
	}

	function levelTone(l: string): 'neutral' | 'warning' | 'danger' | 'success' {
		if (l === 'major_outage') return 'danger';
		if (l === 'partial_outage') return 'danger';
		if (l === 'degraded') return 'warning';
		return 'success';
	}

	const columns = [
		{ key: 'started', label: 'Started' },
		{ key: 'title', label: 'Title' },
		{ key: 'level', label: 'Level' },
		{ key: 'status', label: 'Status' },
		{ key: 'resolved', label: 'Resolved' }
	];
</script>

<svelte:head>
	<title>Incidents — Platform admin</title>
</svelte:head>

<div class="page-header">
	<p class="back-link"><a href="/admin/platform">&larr; Overview</a></p>
	<Kicker>Platform admin</Kicker>
	<h2 class="page-title">Status incidents</h2>
</div>

<div class="toolbar">
	<nav class="tab-nav" aria-label="Incident filter">
		<a href="?filter=active" class="tab-link" class:tab-active={filter === 'active'}>Active</a>
		<a href="?filter=all" class="tab-link" class:tab-active={filter === 'all'}>All</a>
	</nav>
	<Button
		variant="ghost"
		size="sm"
		onclick={() => {
			showDeclare = !showDeclare;
		}}
	>
		{showDeclare ? 'Cancel' : 'Declare incident'}
	</Button>
</div>

{#if showDeclare}
	<Card class="declare-card">
		<form
			onsubmit={(e) => {
				e.preventDefault();
				declare();
			}}
			aria-label="Declare a new incident"
			class="declare-form"
		>
			<Field label="Title" bind:value={title} required maxlength={200} />
			<div class="field-group">
				<label class="field-label" for="declare-level">Severity</label>
				<select id="declare-level" bind:value={level} class="inline-select">
					{#each LEVELS as l}
						<option value={l}>{l}</option>
					{/each}
				</select>
			</div>
			{#if declareError}
				<p class="feedback feedback--err" role="alert">{declareError}</p>
			{/if}
			<div>
				<Button type="submit" disabled={declaring || !title.trim()}>Declare</Button>
			</div>
		</form>
	</Card>
{/if}

<Table {columns} rows={incidents} caption="Status incidents" getKey={(r) => r.id}>
	{#snippet cell(row, col)}
		{#if col.key === 'started'}
			<span class="timestamp">{fmt(row.startedAt)}</span>
		{:else if col.key === 'title'}
			<a href="/admin/platform/incidents/{row.id}" class="incident-link">{row.title}</a>
		{:else if col.key === 'level'}
			<Badge tone={levelTone(row.level)}>{row.level}</Badge>
		{:else if col.key === 'status'}
			<code class="status-code">{row.status}</code>
		{:else if col.key === 'resolved'}
			<span class="timestamp">{row.resolvedAt ? fmt(row.resolvedAt) : '—'}</span>
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="No incidents in this view." />
	{/snippet}
</Table>

<style>
	.page-header {
		margin-bottom: var(--space-5);
	}

	.back-link {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0 0 var(--space-2);
	}

	.back-link a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.back-link a:hover {
		text-decoration: underline;
	}

	.page-title {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		color: var(--color-text);
		margin: var(--space-1) 0 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
		gap: var(--space-4);
	}

	.tab-nav {
		display: flex;
		border-bottom: var(--border-1) solid var(--color-border);
		gap: 0;
	}

	.tab-link {
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		text-decoration: none;
		border-bottom: var(--border-2) solid transparent;
		margin-bottom: calc(-1 * var(--border-1));
		transition: color var(--transition-fast) var(--ease);
	}

	.tab-link:hover {
		color: var(--color-text);
	}

	.tab-active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
	}

	.declare-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 40rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.inline-select {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		align-self: flex-start;
	}

	.feedback {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
	}

	.feedback--err {
		color: var(--color-danger);
		background: var(--color-surface-alt);
		border-left: var(--border-2) solid var(--color-danger);
	}

	.timestamp {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.incident-link {
		color: var(--color-accent);
		text-decoration: none;
		font-size: var(--text-sm);
	}

	.incident-link:hover {
		text-decoration: underline;
	}

	.status-code {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	:global(.declare-card) {
		margin-bottom: var(--space-4);
	}
</style>
