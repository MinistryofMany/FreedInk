<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tooltip } from 'bits-ui';

	interface Props {
		text: string;
		// Receives Bits' trigger props to spread onto a single focusable element
		// (so the tooltip shows on that element's hover AND keyboard focus).
		children: Snippet<[Record<string, unknown>]>;
		class?: string;
	}

	let { text, children }: Props = $props();
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render children(props)}
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
