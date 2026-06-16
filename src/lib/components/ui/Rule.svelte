<script lang="ts">
	interface Props {
		subtle?: boolean;
		class?: string;
	}
	let { subtle = false, class: klass = '' }: Props = $props();
</script>

<hr class={['rule', subtle && 'subtle', klass].filter(Boolean).join(' ')} />

<style>
	.rule {
		height: 1px;
		border: 0;
		background: var(--color-text);
		opacity: 0.8;
		margin: var(--space-5) 0;
	}
	.rule.subtle {
		background: var(--color-border);
		opacity: 1;
	}
</style>
