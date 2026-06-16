<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tabs } from 'bits-ui';

	interface Tab {
		value: string;
		label: string;
	}

	interface Props {
		tabs: Tab[];
		value?: string;
		panel?: Snippet<[string]>;
		children?: Snippet;
	}

	let { tabs, value = $bindable(''), panel, children }: Props = $props();
</script>

<Tabs.Root bind:value class="fi-tabs-root">
	<Tabs.List class="fi-tabs-list">
		{#each tabs as tab (tab.value)}
			<Tabs.Trigger value={tab.value} class="fi-tabs-trigger">
				{tab.label}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>

	{#if panel}
		{@render panel(value)}
	{:else if children}
		{@render children()}
	{/if}
</Tabs.Root>

<style>
	:global(.fi-tabs-root) {
		display: flex;
		flex-direction: column;
	}

	:global(.fi-tabs-list) {
		display: flex;
		border-bottom: var(--border-1) solid var(--color-border);
		gap: 0;
	}

	:global(.fi-tabs-trigger) {
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-bottom: var(--border-2) solid transparent;
		margin-bottom: calc(-1 * var(--border-1));
		cursor: pointer;
		transition:
			color var(--transition-fast) var(--ease),
			border-color var(--transition-fast) var(--ease);
	}

	:global(.fi-tabs-trigger:hover) {
		color: var(--color-text);
	}

	:global(.fi-tabs-trigger[data-state='active']) {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
	}
</style>
