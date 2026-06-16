<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		class?: string;
		children: Snippet;
	}
	let { class: klass = '', children }: Props = $props();
	const cls = $derived(`kicker ${klass}`.trim());
</script>

<span class={cls}>{@render children()}</span>

<style>
	.kicker {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--color-accent);
	}
</style>
