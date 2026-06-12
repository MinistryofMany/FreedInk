<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { ReportStatus } from '$lib/db/reports';
	export let data;
	$: ({ reports, status, page, totalPages, total, counts } = data);
	const STATUSES: ReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

	let busyId: string | null = null;
	let actionError = '';

	async function act(reportId: string, kind: 'resolve' | 'dismiss', notes: string) {
		busyId = reportId;
		actionError = '';
		try {
			const res = await fetch(`/api/platform/reports/${reportId}/${kind}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ notes: notes || undefined })
			});
			if (!res.ok) {
				actionError = (await res.text()) || `${kind} failed`;
				return;
			}
			await invalidateAll();
		} finally {
			busyId = null;
		}
	}

	function ageOf(d: Date | string): string {
		const t = typeof d === 'string' ? Date.parse(d) : d.getTime();
		const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
		return `${Math.floor(seconds / 86400)}d`;
	}

	// Single-source-of-truth per-row notes binding. A map keyed by report
	// id keeps each row's textarea state independent across re-renders.
	let notesByRow: Record<string, string> = {};
</script>

<svelte:head>
	<title>Reports — Platform admin</title>
</svelte:head>

<header>
	<p><a href="/admin/platform">&larr; Overview</a></p>
	<h2>Abuse reports</h2>
	<p class="meta">{total} {status} report(s) &middot; page {page} of {totalPages}</p>
	<nav class="tabs">
		{#each STATUSES as s}
			<a href="?status={s}" class:active={status === s}>
				{s} ({counts[s]})
			</a>
		{/each}
	</nav>
</header>

{#if actionError}
	<p class="err">{actionError}</p>
{/if}

{#if reports.length === 0}
	<p>No reports in this view.</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>Age</th>
				<th>Target</th>
				<th>Reason</th>
				<th>Reporter</th>
				<th>Details</th>
				<th>Action</th>
			</tr>
		</thead>
		<tbody>
			{#each reports as r (r.id)}
				<tr>
					<td>{ageOf(r.createdAt)}</td>
					<td>
						<code>{r.targetType}</code><br />
						{#if r.targetLink}
							<a href={r.targetLink}><small>{r.targetId.slice(0, 8)}…</small></a>
						{:else}
							<small>{r.targetId.slice(0, 8)}…</small>
						{/if}
					</td>
					<td><code>{r.reason}</code></td>
					<td>
						{#if r.reporterUserId}
							{r.reporterUsername ?? r.reporterUserId.slice(0, 8) + '…'}
						{:else}
							<em>anonymous</em>{#if r.reporterIp}<br /><small>{r.reporterIp}</small>{/if}
						{/if}
					</td>
					<td>
						{#if r.details}
							<p class="details">{r.details}</p>
						{:else}
							<em class="muted">—</em>
						{/if}
						{#if r.resolutionNotes}
							<p class="notes">
								<strong>Notes:</strong>
								{r.resolutionNotes}
							</p>
						{/if}
					</td>
					<td>
						{#if status === 'open' || status === 'reviewing'}
							<textarea rows="2" placeholder="Notes (optional)" bind:value={notesByRow[r.id]}
							></textarea>
							<div class="btns">
								<button
									type="button"
									disabled={busyId === r.id}
									on:click={() => act(r.id, 'resolve', notesByRow[r.id] ?? '')}
								>
									Resolve
								</button>
								<button
									type="button"
									disabled={busyId === r.id}
									on:click={() => act(r.id, 'dismiss', notesByRow[r.id] ?? '')}
								>
									Dismiss
								</button>
							</div>
						{:else}
							<small
								>{r.status} by {r.resolvedByUserId
									? r.resolvedByUserId.slice(0, 8) + '…'
									: '—'}</small
							>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<nav class="pager">
		{#if page > 1}
			<a href="?status={status}&page={page - 1}">&larr; Prev</a>
		{/if}
		{#if page < totalPages}
			<a href="?status={status}&page={page + 1}">Next &rarr;</a>
		{/if}
	</nav>
{/if}

<style>
	header {
		margin-bottom: 1rem;
	}
	.meta {
		color: #666;
		font-size: 0.85rem;
	}
	.err {
		color: #b00;
	}
	.tabs {
		display: flex;
		gap: 1rem;
		margin-top: 0.5rem;
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
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th,
	td {
		border-bottom: 1px solid #eee;
		padding: 0.4rem;
		vertical-align: top;
		text-align: left;
	}
	.details {
		margin: 0;
		max-width: 30rem;
		white-space: pre-wrap;
	}
	.notes {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: #555;
	}
	.muted {
		color: #999;
	}
	textarea {
		width: 100%;
		min-width: 12rem;
		font-size: 0.8rem;
	}
	.btns {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.pager {
		display: flex;
		gap: 1rem;
		margin-top: 1rem;
	}
</style>
