<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		Table,
		Button,
		Badge,
		AlertDialog,
		EmptyState,
		Kicker,
		Pagination
	} from '$lib/components/ui';
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

	// Per-row notes state, keyed by report id.
	let notesByRow: Record<string, string> = {};

	// Per-row dialog state.
	let resolveDialogOpen: Record<string, boolean> = {};
	let dismissDialogOpen: Record<string, boolean> = {};

	const columns = [
		{ key: 'age', label: 'Age' },
		{ key: 'target', label: 'Target' },
		{ key: 'reason', label: 'Reason' },
		{ key: 'reporter', label: 'Reporter' },
		{ key: 'details', label: 'Details' },
		{ key: 'action', label: 'Action' }
	];
</script>

<svelte:head>
	<title>Reports — Platform admin</title>
</svelte:head>

<div class="page-header">
	<p class="back-link"><a href="/admin/platform">&larr; Overview</a></p>
	<Kicker>Platform admin</Kicker>
	<h2 class="page-title">Abuse reports</h2>
	<p class="meta">{total} {status} report(s) &middot; page {page} of {totalPages}</p>
</div>

<nav class="tab-nav" aria-label="Report status filter">
	{#each STATUSES as s}
		<a href="?status={s}" class="tab-link" class:tab-active={status === s}>
			{s}
			<Badge tone={status === s ? 'success' : 'neutral'}>{counts[s]}</Badge>
		</a>
	{/each}
</nav>

{#if actionError}
	<p class="feedback feedback--err" role="alert">{actionError}</p>
{/if}

<Table {columns} rows={reports} caption="Abuse reports" getKey={(r) => r.id}>
	{#snippet cell(row, col)}
		{#if col.key === 'age'}
			<span class="timestamp">{ageOf(row.createdAt)}</span>
		{:else if col.key === 'target'}
			<code class="target-type">{row.targetType}</code>
			{#if row.targetLink}
				<a href={row.targetLink} class="target-link">{row.targetId.slice(0, 8)}&hellip;</a>
			{:else}
				<span class="target-id">{row.targetId.slice(0, 8)}&hellip;</span>
			{/if}
		{:else if col.key === 'reason'}
			<code class="reason-code">{row.reason}</code>
		{:else if col.key === 'reporter'}
			{#if row.reporterUserId}
				{row.reporterUsername ?? row.reporterUserId.slice(0, 8) + '…'}
			{:else}
				<em class="muted">anonymous</em>
				{#if row.reporterIp}
					<span class="ip-hint">{row.reporterIp}</span>
				{/if}
			{/if}
		{:else if col.key === 'details'}
			{#if row.details}
				<p class="details">{row.details}</p>
			{:else}
				<em class="muted">—</em>
			{/if}
			{#if row.resolutionNotes}
				<p class="notes"><strong>Notes:</strong> {row.resolutionNotes}</p>
			{/if}
		{:else if col.key === 'action'}
			{#if status === 'open' || status === 'reviewing'}
				<div class="action-cell">
					<textarea
						rows="2"
						placeholder="Notes (optional)"
						bind:value={notesByRow[row.id]}
						class="notes-input"
					></textarea>
					<div class="action-btns">
						<AlertDialog
							bind:open={resolveDialogOpen[row.id]}
							title="Resolve this report?"
							description="Mark the report as resolved. Notes will be saved."
							confirmLabel="Resolve"
							cancelLabel="Cancel"
							onConfirm={() => act(row.id, 'resolve', notesByRow[row.id] ?? '')}
						>
							{#snippet trigger(props)}
								<Button variant="primary" size="sm" disabled={busyId === row.id} {...props}>
									Resolve
								</Button>
							{/snippet}
						</AlertDialog>
						<AlertDialog
							bind:open={dismissDialogOpen[row.id]}
							title="Dismiss this report?"
							description="Mark the report as dismissed. Notes will be saved."
							confirmLabel="Dismiss"
							cancelLabel="Cancel"
							onConfirm={() => act(row.id, 'dismiss', notesByRow[row.id] ?? '')}
						>
							{#snippet trigger(props)}
								<Button variant="ghost" size="sm" disabled={busyId === row.id} {...props}>
									Dismiss
								</Button>
							{/snippet}
						</AlertDialog>
					</div>
				</div>
			{:else}
				<span class="resolved-by"
					>{row.status} by {row.resolvedByUserId
						? row.resolvedByUserId.slice(0, 8) + '…'
						: '—'}</span
				>
			{/if}
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="No reports in this view." />
	{/snippet}
</Table>

{#if totalPages > 1}
	<div class="pager">
		<Pagination {page} pageCount={totalPages} makeHref={(p) => `?status=${status}&page=${p}`} />
	</div>
{/if}

<style>
	.page-header {
		margin-bottom: var(--space-4);
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

	.meta {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}

	.tab-nav {
		display: flex;
		border-bottom: var(--border-1) solid var(--color-border);
		gap: 0;
		margin-bottom: var(--space-4);
	}

	.tab-link {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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

	.feedback {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
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

	.target-type {
		display: block;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.target-link {
		font-size: var(--text-xs);
		color: var(--color-accent);
	}

	.target-id {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.reason-code {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.muted {
		color: var(--color-text-muted);
	}

	.ip-hint {
		display: block;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.details {
		margin: 0;
		max-width: 24rem;
		white-space: pre-wrap;
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	.notes {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.action-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 10rem;
	}

	.notes-input {
		width: 100%;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		resize: vertical;
	}

	.action-btns {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.resolved-by {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.pager {
		margin-top: var(--space-5);
	}
</style>
