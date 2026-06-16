<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		class?: string;
		children: Snippet;
	}
	let { class: klass = '', children }: Props = $props();
</script>

<blockquote class={['pullquote', klass].filter(Boolean).join(' ')}>
	{@render children()}
</blockquote>

<style>
	.pullquote {
		border-left: var(--border-2) solid var(--color-accent);
		padding-left: var(--space-4);
		font-family: var(--font-standfirst);
		font-style: italic;
		font-size: var(--text-lg);
		color: var(--color-text);
		margin: var(--space-5) 0;
	}
</style>
