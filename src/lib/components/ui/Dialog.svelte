<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import X from 'phosphor-svelte/lib/X';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		trigger?: Snippet;
		children: Snippet;
		class?: string;
	}

	let {
		open = $bindable(false),
		title,
		description,
		trigger,
		children,
		class: klass = ''
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	{#if trigger}
		<Dialog.Trigger>
			{@render trigger()}
		</Dialog.Trigger>
	{/if}

	<Dialog.Portal>
		<Dialog.Overlay class="fi-dialog-overlay" />
		<Dialog.Content class="fi-dialog-content {klass}">
			<div class="fi-dialog-header">
				<Dialog.Title class="fi-dialog-title">{title}</Dialog.Title>
				<Dialog.Close class="fi-dialog-close" aria-label="Close">
					<X size={20} />
				</Dialog.Close>
			</div>
			{#if description}
				<Dialog.Description class="fi-dialog-desc">{description}</Dialog.Description>
			{/if}
			<div class="fi-dialog-body">
				{@render children()}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.fi-dialog-overlay) {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.45);
		z-index: 50;
	}

	:global(.fi-dialog-content) {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 51;
		width: min(480px, calc(100vw - var(--space-6)));
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elev-2);
		padding: var(--space-5);
	}

	:global(.fi-dialog-header) {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	:global(.fi-dialog-title) {
		font-family: var(--font-ui);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	:global(.fi-dialog-close) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-1);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: color var(--transition-fast) var(--ease);
	}

	:global(.fi-dialog-close:hover) {
		color: var(--color-text);
	}

	:global(.fi-dialog-desc) {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-4);
	}

	:global(.fi-dialog-body) {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		color: var(--color-text);
	}
</style>
