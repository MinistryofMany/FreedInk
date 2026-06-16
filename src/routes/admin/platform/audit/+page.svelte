<script lang="ts">
	import { Table, Pagination, EmptyState, Kicker } from '$lib/components/ui';

	export let data;
	$: ({ entries, page, totalPages, total } = data);

	const columns = [
		{ key: 'when', label: 'When' },
		{ key: 'event', label: 'Event' },
		{ key: 'actor', label: 'Actor' },
		{ key: 'subject_user', label: 'Subject user' },
		{ key: 'subject_blog', label: 'Subject blog' },
		{ key: 'metadata', label: 'Metadata' }
	];
</script>

<svelte:head>
	<title>Audit log — Platform admin</title>
</svelte:head>

<div class="page-header">
	<p class="back-link"><a href="/admin/platform">&larr; Overview</a></p>
	<Kicker>Platform admin</Kicker>
	<h2 class="page-title">Audit log</h2>
	<p class="meta">{total} entries &middot; page {page} of {totalPages}</p>
</div>

<Table {columns} rows={entries} caption="Audit log entries">
	{#snippet cell(row, col)}
		{#if col.key === 'when'}
			{new Date(row.createdAt).toLocaleString()}
		{:else if col.key === 'event'}
			<code>{row.event}</code>
		{:else if col.key === 'actor'}
			<code>{row.actorUserId ?? '—'}</code>
		{:else if col.key === 'subject_user'}
			<code>{row.subjectUserId ?? '—'}</code>
		{:else if col.key === 'subject_blog'}
			<code>{row.subjectBlogId ?? '—'}</code>
		{:else if col.key === 'metadata'}
			{#if row.metadata}
				<pre>{JSON.stringify(row.metadata)}</pre>
			{/if}
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="No audit entries" />
	{/snippet}
</Table>

{#if totalPages > 1}
	<div class="pager">
		<Pagination {page} pageCount={totalPages} makeHref={(p) => `?page=${p}`} />
	</div>
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

	.meta {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}

	.pager {
		margin-top: var(--space-4);
	}

	code {
		font-size: var(--text-xs);
	}

	pre {
		font-size: var(--text-xs);
		margin: 0;
		white-space: pre-wrap;
		max-width: 30rem;
		color: var(--color-text);
	}
</style>
