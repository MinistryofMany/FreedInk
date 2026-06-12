<script lang="ts">
	import { invalidateAll, goto } from '$app/navigation';
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
</script>

<svelte:head>
	<title>Incidents — Platform admin</title>
</svelte:head>

<header>
	<p><a href="/admin/platform">&larr; Overview</a></p>
	<h2>Status incidents</h2>
	<nav class="tabs">
		<a href="?filter=active" class:active={filter === 'active'}>Active</a>
		<a href="?filter=all" class:active={filter === 'all'}>All</a>
	</nav>
	<button type="button" on:click={() => (showDeclare = !showDeclare)}>
		{showDeclare ? 'Cancel' : 'Declare incident'}
	</button>
</header>

{#if showDeclare}
	<form
		class="declare"
		on:submit|preventDefault={declare}
		aria-label="Declare a new incident"
	>
		<label>
			Title
			<input type="text" bind:value={title} required maxlength="200" />
		</label>
		<label>
			Severity
			<select bind:value={level}>
				{#each LEVELS as l}
					<option value={l}>{l}</option>
				{/each}
			</select>
		</label>
		{#if declareError}
			<p class="err">{declareError}</p>
		{/if}
		<button type="submit" disabled={declaring || !title.trim()}>Declare</button>
	</form>
{/if}

{#if incidents.length === 0}
	<p>No incidents in this view.</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>Started</th>
				<th>Title</th>
				<th>Level</th>
				<th>Status</th>
				<th>Resolved</th>
			</tr>
		</thead>
		<tbody>
			{#each incidents as i (i.id)}
				<tr>
					<td>{fmt(i.startedAt)}</td>
					<td><a href={`/admin/platform/incidents/${i.id}`}>{i.title}</a></td>
					<td><code class="level level-{i.level}">{i.level}</code></td>
					<td><code>{i.status}</code></td>
					<td>{i.resolvedAt ? fmt(i.resolvedAt) : '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	header {
		margin-bottom: 1rem;
	}
	.tabs {
		display: flex;
		gap: 0.5rem;
		margin: 0.5rem 0;
	}
	.tabs a {
		padding: 0.25rem 0.5rem;
		border: 1px solid #ddd;
		border-radius: 0.25rem;
		text-decoration: none;
		font-size: 0.85rem;
	}
	.tabs a.active {
		background: #f0f0f0;
		font-weight: 600;
	}
	.declare {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid #ddd;
		border-radius: 0.25rem;
		margin: 0.75rem 0;
	}
	.declare label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.2rem;
	}
	.declare button {
		grid-column: 1 / -1;
		justify-self: end;
	}
	.err {
		grid-column: 1 / -1;
		color: #b00;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem;
		border-bottom: 1px solid #eee;
		vertical-align: top;
	}
	.level {
		padding: 0.05rem 0.4rem;
		border-radius: 0.2rem;
		color: #fff;
		font-size: 0.75rem;
	}
	.level-operational {
		background: #2e7d32;
	}
	.level-degraded {
		background: #b08900;
	}
	.level-partial_outage {
		background: #d65a00;
	}
	.level-major_outage {
		background: #c62828;
	}
</style>
