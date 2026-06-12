<script lang="ts">
	export let data;
	$: ({ entries, page, totalPages, total } = data);
</script>

<svelte:head>
	<title>Audit log — Platform admin</title>
</svelte:head>

<header>
	<p><a href="/admin/platform">&larr; Overview</a></p>
	<h2>Audit log</h2>
	<p class="meta">{total} entries &middot; page {page} of {totalPages}</p>
</header>

{#if entries.length === 0}
	<p>No audit entries.</p>
{:else}
	<!-- Desktop: dense audit-style table. Phones / narrow tablets get the
	     same rows as stacked cards via the card-list below. -->
	<table class="hide-mobile">
		<thead>
			<tr>
				<th>When</th>
				<th>Event</th>
				<th>Actor</th>
				<th>Subject user</th>
				<th>Subject blog</th>
				<th>Metadata</th>
			</tr>
		</thead>
		<tbody>
			{#each entries as e}
				<tr>
					<td>{new Date(e.createdAt).toLocaleString()}</td>
					<td><code>{e.event}</code></td>
					<td><code>{e.actorUserId ?? '—'}</code></td>
					<td><code>{e.subjectUserId ?? '—'}</code></td>
					<td><code>{e.subjectBlogId ?? '—'}</code></td>
					<td><pre>{e.metadata ? JSON.stringify(e.metadata) : ''}</pre></td>
				</tr>
			{/each}
		</tbody>
	</table>

	<ul class="card-list show-mobile" aria-label="Audit entries">
		{#each entries as e}
			<li class="card">
				<dl>
					<div>
						<dt>When</dt>
						<dd>{new Date(e.createdAt).toLocaleString()}</dd>
					</div>
					<div>
						<dt>Event</dt>
						<dd><code>{e.event}</code></dd>
					</div>
					<div>
						<dt>Actor</dt>
						<dd><code>{e.actorUserId ?? '—'}</code></dd>
					</div>
					<div>
						<dt>Subject user</dt>
						<dd><code>{e.subjectUserId ?? '—'}</code></dd>
					</div>
					<div>
						<dt>Subject blog</dt>
						<dd><code>{e.subjectBlogId ?? '—'}</code></dd>
					</div>
					{#if e.metadata}
						<div>
							<dt>Metadata</dt>
							<dd><pre>{JSON.stringify(e.metadata, null, 2)}</pre></dd>
						</div>
					{/if}
				</dl>
			</li>
		{/each}
	</ul>

	<nav class="pager" aria-label="Audit pages">
		{#if page > 1}
			<a href="?page={page - 1}">&larr; Prev</a>
		{/if}
		{#if page < totalPages}
			<a href="?page={page + 1}">Next &rarr;</a>
		{/if}
	</nav>
{/if}

<style>
	header {
		margin-bottom: 1rem;
	}
	.meta {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	th,
	td {
		border-bottom: 1px solid var(--color-border);
		padding: 0.5rem 0.4rem;
		text-align: left;
		vertical-align: top;
		color: var(--color-text);
	}
	th {
		background: var(--color-surface-alt);
	}
	code,
	pre {
		font-size: var(--text-xs);
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
		max-width: 30rem;
		color: var(--color-text);
	}
	.pager {
		display: flex;
		gap: 1rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}
	.pager a {
		min-height: var(--touch-target);
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		background: var(--color-surface);
	}

	.card-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.85rem 1rem;
		box-shadow: var(--shadow-elev-1);
	}
	.card dl {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem 1rem;
		margin: 0;
	}
	.card dl > div {
		display: grid;
		grid-template-columns: minmax(7rem, auto) 1fr;
		gap: 0.25rem 0.75rem;
	}
	.card dt {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.card dd {
		margin: 0;
		word-break: break-word;
	}
	.card pre {
		max-width: 100%;
		overflow-x: auto;
	}

	.show-mobile {
		display: none;
	}
	.hide-mobile {
		display: table;
	}
	@media (max-width: 767px) {
		.show-mobile {
			display: flex;
		}
		.hide-mobile {
			display: none;
		}
	}
</style>
