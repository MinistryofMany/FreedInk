<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import { DropdownMenu } from 'bits-ui';
	import DotsThreeVertical from 'phosphor-svelte/lib/DotsThreeVertical';

	interface MenuItem {
		label: string;
		onSelect: () => void;
		danger?: boolean;
		icon?: Component;
	}

	interface Props {
		items: MenuItem[];
		trigger?: Snippet;
		class?: string;
	}

	let { items, trigger, class: klass = '' }: Props = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class="fi-ddm-trigger" aria-label={trigger ? undefined : 'Menu'}>
		{#if trigger}
			{@render trigger()}
		{:else}
			<DotsThreeVertical size={20} weight="bold" />
		{/if}
	</DropdownMenu.Trigger>

	<DropdownMenu.Portal>
		<DropdownMenu.Content class="fi-ddm-content {klass}">
			{#each items as item (item.label)}
				<DropdownMenu.Item
					class="fi-ddm-item {item.danger ? 'fi-ddm-item--danger' : ''}"
					onSelect={item.onSelect}
				>
					{#if item.icon}
						<item.icon size={16} />
					{/if}
					{item.label}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
	:global(.fi-ddm-trigger) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-1);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color var(--transition-fast) var(--ease);
	}

	:global(.fi-ddm-trigger:hover) {
		color: var(--color-text);
	}

	:global(.fi-ddm-content) {
		min-width: 160px;
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-elev-2);
		padding: var(--space-1) 0;
		z-index: 60;
	}

	:global(.fi-ddm-item) {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: background var(--transition-fast) var(--ease);
	}

	:global(.fi-ddm-item:hover),
	:global(.fi-ddm-item[data-highlighted]) {
		background: var(--color-surface-alt);
	}

	:global(.fi-ddm-item--danger) {
		color: var(--color-danger);
	}
</style>
