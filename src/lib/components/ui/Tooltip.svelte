<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tooltip } from 'bits-ui';

	interface Props {
		text: string;
		children: Snippet;
		class?: string;
	}

	let { text, children, class: klass = '' }: Props = $props();
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<span {...props} class="fi-tooltip-trigger {klass}">{@render children()}</span>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content class="fi-tooltip-content" sideOffset={6}>
				{text}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>

<style>
	:global(.fi-tooltip-trigger) {
		display: inline-flex;
		align-items: center;
		background: none;
		border: none;
		padding: 0;
		cursor: inherit;
	}

	:global(.fi-tooltip-content) {
		z-index: 70;
		max-width: 240px;
		padding: var(--space-1) var(--space-2);
		background: var(--color-text);
		color: var(--color-bg);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		border-radius: var(--radius-sm);
		pointer-events: none;
	}
</style>
