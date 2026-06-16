<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		tone?: 'neutral' | 'success' | 'warning' | 'danger';
		class?: string;
		children: Snippet;
	}
	let { tone = 'neutral', class: klass = '', children }: Props = $props();
	const cls = $derived(`badge ${tone} ${klass}`.trim());
</script>

<span class={cls}>{@render children()}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		line-height: 1;
		white-space: nowrap;
	}
	.neutral {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}
	.success {
		background: var(--color-surface-alt);
		color: var(--color-accent);
	}
	.warning {
		background: var(--color-surface-alt);
		color: var(--color-warning);
	}
	.danger {
		background: var(--color-surface-alt);
		color: var(--color-danger);
	}
</style>
