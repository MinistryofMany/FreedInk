<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		variant?: 'outline' | 'solid' | 'muted';
		class?: string;
		children: Snippet;
	}
	let { variant = 'outline', class: klass = '', children }: Props = $props();
	const cls = $derived(`tag ${variant} ${klass}`.trim());
</script>

<span class={cls}>{@render children()}</span>

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border-radius: var(--radius-pill);
		padding: var(--space-1) var(--space-3);
		line-height: 1;
		white-space: nowrap;
	}
	.outline {
		border: var(--border-1) solid var(--color-border);
		background: transparent;
		color: var(--color-accent);
	}
	.solid {
		border: var(--border-1) solid transparent;
		background: var(--color-accent);
		color: var(--color-bg);
	}
	.muted {
		border: var(--border-1) solid transparent;
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}
</style>
