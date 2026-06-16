<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Card, Field, Button, Badge, EmptyState, Kicker } from '$lib/components/ui';
	import type { PageData } from './$types';
	import type { IncidentStatus } from '$lib/db/status';
	export let data: PageData;
	$: ({ incident, updates } = data);

	const STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];

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

	function levelTone(l: string): 'neutral' | 'warning' | 'danger' | 'success' {
		if (l === 'major_outage') return 'danger';
		if (l === 'partial_outage') return 'danger';
		if (l === 'degraded') return 'warning';
		return 'success';
	}
</script>

<svelte:head>
	<title>{incident.title} — Incidents</title>
</svelte:head>

<div class="page-header">
	<p class="back-link"><a href="/admin/platform/incidents">&larr; All incidents</a></p>
	<Kicker>Incident</Kicker>
	<h2 class="page-title">{incident.title}</h2>
	<div class="meta-row">
		<Badge tone={levelTone(incident.level)}>{incident.level}</Badge>
		<code class="status-code">{incident.status}</code>
		<span class="meta-text">started {fmt(incident.startedAt)}</span>
		{#if incident.resolvedAt}
			<span class="meta-text">resolved {fmt(incident.resolvedAt)}</span>
		{/if}
	</div>
</div>

<section class="section">
	<h3 class="section-title">Timeline</h3>
	{#if updates.length === 0}
		<EmptyState title="No updates yet." />
	{:else}
		<ol class="timeline">
			{#each updates as u (u.id)}
				<li>
					<Card padding="sm">
						<div class="update-header">
							<code class="status-code">{u.status}</code>
							<span class="timestamp">{fmt(u.createdAt)}</span>
						</div>
						<p class="update-body">{u.body}</p>
					</Card>
				</li>
			{/each}
		</ol>
	{/if}
</section>

{#if incident.status !== 'resolved'}
	<section class="section">
		<h3 class="section-title">Post update</h3>
		<Card>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					postUpdate();
				}}
				aria-label="Post incident update"
				class="incident-form"
			>
				<div class="field-group">
					<label class="field-label" for="update-status">Status</label>
					<select id="update-status" bind:value={updateStatus} class="inline-select">
						{#each STATUSES.filter((s) => s !== 'resolved') as s}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>
				<Field label="Body" multiline bind:value={updateBody} required maxlength={4000} rows={3} />
				{#if postError}
					<p class="feedback feedback--err" role="alert">{postError}</p>
				{/if}
				<div>
					<Button type="submit" disabled={posting || !updateBody.trim()}>Post update</Button>
				</div>
			</form>
		</Card>
	</section>

	<section class="section">
		<h3 class="section-title">Resolve</h3>
		<Card>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					resolve();
				}}
				aria-label="Resolve incident"
				class="incident-form"
			>
				<Field
					label="Resolution note (optional)"
					multiline
					bind:value={resolveBody}
					maxlength={4000}
					rows={2}
				/>
				{#if resolveError}
					<p class="feedback feedback--err" role="alert">{resolveError}</p>
				{/if}
				<div>
					<Button type="submit" disabled={resolving}>Resolve incident</Button>
				</div>
			</form>
		</Card>
	</section>
{:else}
	<p class="resolved-note">This incident is resolved.</p>
{/if}

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

	.meta-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}

	.meta-text {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.status-code {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.section {
		margin-top: var(--space-6);
	}

	.section-title {
		font-family: var(--font-ui);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 var(--space-3);
	}

	.timeline {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.update-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.timestamp {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.update-body {
		font-size: var(--text-sm);
		color: var(--color-text);
		margin: 0;
	}

	.incident-form {
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

	.resolved-note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		font-style: italic;
		margin-top: var(--space-5);
	}
</style>
