<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { IncidentStatus } from '$lib/db/status';
	export let data: PageData;
	$: ({ incident, updates } = data);

	const STATUSES: IncidentStatus[] = [
		'investigating',
		'identified',
		'monitoring',
		'resolved'
	];

	let updateStatus: IncidentStatus = 'investigating';
	let updateBody = '';
	let posting = false;
	let postError = '';

	let resolveBody = '';
	let resolving = false;
	let resolveError = '';

	$: if (incident && !posting) {
		// Default the dropdown to the current status whenever the underlying
		// data refreshes, so the operator's "post update" form mirrors reality.
		if (updateStatus !== incident.status && incident.status !== 'resolved') {
			updateStatus = incident.status as IncidentStatus;
		}
	}

	async function postUpdate() {
		posting = true;
		postError = '';
		try {
			const res = await fetch(`/api/platform/incidents/${incident.id}/update`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: updateStatus, body: updateBody })
			});
			if (!res.ok) {
				postError = (await res.text()) || `post update failed (${res.status})`;
				return;
			}
			updateBody = '';
			await invalidateAll();
		} finally {
			posting = false;
		}
	}

	async function resolve() {
		resolving = true;
		resolveError = '';
		try {
			const res = await fetch(`/api/platform/incidents/${incident.id}/resolve`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body: resolveBody || undefined })
			});
			if (!res.ok) {
				resolveError = (await res.text()) || `resolve failed (${res.status})`;
				return;
			}
			resolveBody = '';
			await invalidateAll();
		} finally {
			resolving = false;
		}
	}

	function fmt(d: Date | string): string {
		const t = typeof d === 'string' ? new Date(d) : d;
		return t.toLocaleString();
	}
</script>

<svelte:head>
	<title>{incident.title} — Incidents</title>
</svelte:head>

<header>
	<p><a href="/admin/platform/incidents">&larr; All incidents</a></p>
	<h2>{incident.title}</h2>
	<p class="meta">
		<code class="level level-{incident.level}">{incident.level}</code>
		· status <code>{incident.status}</code>
		· started {fmt(incident.startedAt)}
		{#if incident.resolvedAt}· resolved {fmt(incident.resolvedAt)}{/if}
	</p>
</header>

<section>
	<h3>Timeline</h3>
	{#if updates.length === 0}
		<p>No updates yet.</p>
	{:else}
		<ol class="timeline">
			{#each updates as u (u.id)}
				<li>
					<header>
						<code>{u.status}</code>
						<span class="when">{fmt(u.createdAt)}</span>
					</header>
					<p>{u.body}</p>
				</li>
			{/each}
		</ol>
	{/if}
</section>

{#if incident.status !== 'resolved'}
	<section>
		<h3>Post update</h3>
		<form on:submit|preventDefault={postUpdate} aria-label="Post incident update">
			<label>
				Status
				<select bind:value={updateStatus}>
					{#each STATUSES.filter((s) => s !== 'resolved') as s}
						<option value={s}>{s}</option>
					{/each}
				</select>
			</label>
			<label>
				Body
				<textarea bind:value={updateBody} rows="3" required maxlength="4000"></textarea>
			</label>
			{#if postError}
				<p class="err">{postError}</p>
			{/if}
			<button type="submit" disabled={posting || !updateBody.trim()}>Post update</button>
		</form>
	</section>

	<section>
		<h3>Resolve</h3>
		<form on:submit|preventDefault={resolve} aria-label="Resolve incident">
			<label>
				Resolution note (optional)
				<textarea bind:value={resolveBody} rows="2" maxlength="4000"></textarea>
			</label>
			{#if resolveError}
				<p class="err">{resolveError}</p>
			{/if}
			<button type="submit" disabled={resolving}>Resolve incident</button>
		</form>
	</section>
{:else}
	<p class="resolved-note">This incident is resolved.</p>
{/if}

<style>
	header {
		margin-bottom: 1rem;
	}
	.meta {
		font-size: 0.85rem;
		color: #555;
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
	.timeline {
		list-style: none;
		padding: 0;
		margin: 0 0 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.timeline li {
		border: 1px solid #eee;
		border-radius: 0.25rem;
		padding: 0.5rem 0.75rem;
	}
	.timeline header {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.25rem;
	}
	.timeline .when {
		font-size: 0.8rem;
		color: #777;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 40rem;
		margin-bottom: 1.5rem;
	}
	form label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.2rem;
	}
	form button {
		align-self: flex-start;
	}
	.err {
		color: #b00;
	}
	.resolved-note {
		font-style: italic;
		color: #555;
	}
</style>
