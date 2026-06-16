<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		padding?: 'sm' | 'md' | 'lg';
		elevated?: boolean;
		class?: string;
		children: Snippet;
	}
	let { padding = 'md', elevated = false, class: klass = '', children }: Props = $props();
	const cls = $derived(`card pad-${padding} ${elevated ? 'elevated' : ''} ${klass}`.trim());
</script>

<div class={cls}>{@render children()}</div>

<style>
	.card {
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	.pad-sm {
		padding: var(--space-3);
	}
	.pad-md {
		padding: var(--space-5);
	}
	.pad-lg {
		padding: var(--space-6);
	}
	.elevated {
		box-shadow: var(--shadow-elev-1);
	}
</style>
