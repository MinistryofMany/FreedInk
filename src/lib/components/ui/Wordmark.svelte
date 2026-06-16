<script lang="ts">
	interface Props {
		as?: 'a' | 'span';
		href?: string;
		class?: string;
	}
	let { as = 'a', href = '/', class: klass = '' }: Props = $props();
	const cls = $derived(['wordmark', klass].filter(Boolean).join(' '));
</script>

{#if as === 'a'}
	<a {href} class={cls}><span class="freed">Freed</span><span class="ink">Ink</span></a>
{:else}
	<span class={cls}><span class="freed">Freed</span><span class="ink">Ink</span></span>
{/if}

<style>
	.wordmark {
		display: inline-flex;
		align-items: baseline;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: var(--text-lg);
		letter-spacing: -0.01em;
		text-decoration: none;
		line-height: 1;
	}
	.freed {
		color: var(--color-text);
	}
	.ink {
		color: var(--color-accent);
	}
</style>
