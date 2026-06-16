<script lang="ts">
	interface Props {
		author: string;
		meta?: string[];
		class?: string;
	}
	let { author, meta = [], class: klass = '' }: Props = $props();
</script>

<p class={['byline', klass].filter(Boolean).join(' ')}>
	<span class="by">By <strong>{author}</strong></span>
	{#each meta as item}
		<span class="dot" aria-hidden="true">·</span>
		<span class="meta-item">{item}</span>
	{/each}
</p>

<style>
	.byline {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin: 0;
	}
	.by strong {
		color: var(--color-text);
		font-weight: 600;
	}
	.dot {
		color: var(--color-text-muted);
	}
	.meta-item {
		color: var(--color-text-muted);
	}
</style>
