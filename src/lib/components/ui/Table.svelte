<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Column {
		key: string;
		label: string;
		align?: 'left' | 'right' | 'center';
	}

	interface Props {
		columns: Column[];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		rows: any[];
		caption?: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		getKey?: (row: any, i: number) => string | number;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		cell: Snippet<[any, Column]>;
		empty?: Snippet;
		class?: string;
	}

	let { columns, rows, caption, getKey, cell, empty, class: klass = '' }: Props = $props();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const keyOf = (row: any, i: number) => (getKey ? getKey(row, i) : i);
</script>

<div class={['fi-table', klass].filter(Boolean).join(' ')}>
	{#if rows.length === 0}
		{#if empty}
			{@render empty()}
		{:else}
			<p class="t-empty">No items.</p>
		{/if}
	{:else}
		<table class="t-desktop">
			{#if caption}
				<caption class="sr-only">{caption}</caption>
			{/if}
			<thead>
				<tr>
					{#each columns as col (col.key)}
						<th
							scope="col"
							class:right={col.align === 'right'}
							class:center={col.align === 'center'}>{col.label}</th
						>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row, i (keyOf(row, i))}
					<tr>
						{#each columns as col (col.key)}
							<td class:right={col.align === 'right'} class:center={col.align === 'center'}
								>{@render cell(row, col)}</td
							>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>

		<ul class="t-mobile" aria-label={caption}>
			{#each rows as row, i (keyOf(row, i))}
				<li class="t-card">
					<dl>
						{#each columns as col (col.key)}
							<div class="t-field">
								<dt>{col.label}</dt>
								<dd>{@render cell(row, col)}</dd>
							</div>
						{/each}
					</dl>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.t-desktop {
		width: 100%;
		border-collapse: collapse;
	}

	.t-desktop th {
		text-align: left;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
		background: var(--color-surface-alt);
		padding: var(--space-2) var(--space-3);
		border-bottom: var(--border-1) solid var(--color-border);
	}

	.t-desktop td {
		padding: var(--space-3);
		border-top: var(--border-1) solid var(--color-border);
		font-size: var(--text-sm);
		color: var(--color-text);
		vertical-align: top;
	}

	.t-desktop th.right,
	.t-desktop td.right {
		text-align: right;
	}

	.t-desktop th.center,
	.t-desktop td.center {
		text-align: center;
	}

	.t-mobile {
		list-style: none;
		padding: 0;
		margin: 0;
		display: none;
		flex-direction: column;
		gap: var(--space-3);
	}

	.t-card {
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}

	.t-card dl {
		margin: 0;
	}

	.t-field {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-1) 0;
		border-bottom: var(--border-1) solid var(--color-border);
	}

	.t-field:last-child {
		border-bottom: none;
	}

	.t-field dt {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		text-transform: uppercase;
	}

	.t-field dd {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text);
		text-align: right;
	}

	.t-empty {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
		padding: var(--space-3) 0;
	}

	.fi-table .t-desktop {
		display: table;
	}

	.fi-table .t-mobile {
		display: none;
	}

	@media (max-width: 767px) {
		.fi-table .t-desktop {
			display: none;
		}

		.fi-table .t-mobile {
			display: flex;
		}
	}
</style>
