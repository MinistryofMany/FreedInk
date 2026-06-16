<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		variant?: 'primary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		href?: string;
		type?: 'button' | 'submit';
		disabled?: boolean;
		loading?: boolean;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	}
	let {
		variant = 'primary',
		size = 'md',
		href,
		type = 'button',
		disabled = false,
		loading = false,
		class: klass = '',
		onclick,
		children
	}: Props = $props();
	const cls = $derived(`btn ${variant} ${size} ${klass}`.trim());
</script>

{#if href}
	<a {href} class={cls} aria-disabled={disabled || undefined} {onclick}>{@render children()}</a>
{:else}
	<button
		{type}
		class={cls}
		disabled={disabled || loading}
		{onclick}
		aria-busy={loading || undefined}>{@render children()}</button
	>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-weight: 600;
		line-height: 1;
		border: var(--border-1) solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-decoration: none;
		transition:
			background var(--transition-fast) var(--ease),
			color var(--transition-fast) var(--ease);
	}
	.md {
		padding: 0 var(--space-4);
		min-height: var(--touch-target);
		font-size: var(--text-sm);
	}
	.sm {
		padding: 0 var(--space-3);
		min-height: 2rem;
		font-size: var(--text-xs);
	}
	.primary {
		background: var(--color-accent);
		color: var(--color-bg);
	}
	.primary:hover {
		background: var(--color-link-hover);
	}
	.ghost {
		background: transparent;
		color: var(--color-accent);
		border-color: var(--color-accent);
	}
	.ghost:hover {
		background: var(--color-surface-alt);
	}
	.danger {
		background: var(--color-danger);
		color: var(--color-bg);
	}
	.btn:disabled,
	.btn[aria-disabled='true'] {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
