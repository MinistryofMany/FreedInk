<script lang="ts">
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CaretRight from 'phosphor-svelte/lib/CaretRight';

	interface Props {
		page: number;
		pageCount: number;
		makeHref?: (page: number) => string;
		onchange?: (page: number) => void;
		class?: string;
	}
	let { page, pageCount, makeHref, onchange, class: klass = '' }: Props = $props();

	const atFirst = $derived(page <= 1);
	const atLast = $derived(page >= pageCount);
	const prevPage = $derived(page - 1);
	const nextPage = $derived(page + 1);
</script>

<nav aria-label="Pagination" class={['pagination', klass].filter(Boolean).join(' ')}>
	{#if makeHref}
		{#if atFirst}
			<a
				href={makeHref(prevPage)}
				class="page-ctrl"
				aria-label="Previous page"
				aria-disabled="true"
				tabindex="-1"><CaretLeft size="1em" /></a
			>
		{:else}
			<a href={makeHref(prevPage)} class="page-ctrl" aria-label="Previous page"
				><CaretLeft size="1em" /></a
			>
		{/if}
	{:else}
		<button
			type="button"
			class="page-ctrl"
			aria-label="Previous page"
			disabled={atFirst}
			onclick={() => !atFirst && onchange?.(prevPage)}><CaretLeft size="1em" /></button
		>
	{/if}

	<span class="page-label">Page {page} of {pageCount}</span>

	{#if makeHref}
		{#if atLast}
			<a
				href={makeHref(nextPage)}
				class="page-ctrl"
				aria-label="Next page"
				aria-disabled="true"
				tabindex="-1"><CaretRight size="1em" /></a
			>
		{:else}
			<a href={makeHref(nextPage)} class="page-ctrl" aria-label="Next page"
				><CaretRight size="1em" /></a
			>
		{/if}
	{:else}
		<button
			type="button"
			class="page-ctrl"
			aria-label="Next page"
			disabled={atLast}
			onclick={() => !atLast && onchange?.(nextPage)}><CaretRight size="1em" /></button
		>
	{/if}
</nav>

<style>
	.pagination {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
	}
	.page-label {
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.page-ctrl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--touch-target);
		min-height: var(--touch-target);
		background: transparent;
		color: var(--color-text);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-decoration: none;
		transition: background var(--transition-fast) var(--ease);
	}
	.page-ctrl:hover:not(:disabled):not([aria-disabled='true']) {
		background: var(--color-surface-alt);
	}
	.page-ctrl:disabled,
	.page-ctrl[aria-disabled='true'] {
		opacity: 0.4;
		cursor: not-allowed;
		pointer-events: none;
	}
</style>
