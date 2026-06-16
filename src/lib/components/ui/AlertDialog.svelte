<script lang="ts">
	import type { Snippet } from 'svelte';
	import { AlertDialog } from 'bits-ui';
	import Button from './Button.svelte';

	interface Props {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		onConfirm: () => void;
		tone?: 'danger';
		// Receives Bits' trigger props to spread onto a single focusable element.
		trigger?: Snippet<[Record<string, unknown>]>;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		onConfirm,
		tone,
		trigger
	}: Props = $props();
</script>

<AlertDialog.Root bind:open>
	{#if trigger}
		<AlertDialog.Trigger>
			{#snippet child({ props })}
				{@render trigger(props)}
			{/snippet}
		</AlertDialog.Trigger>
	{/if}

	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fi-adlg-overlay" />
		<AlertDialog.Content class="fi-adlg-content">
			<AlertDialog.Title class="fi-adlg-title">{title}</AlertDialog.Title>
			<AlertDialog.Description class="fi-adlg-desc">{description}</AlertDialog.Description>
			<div class="fi-adlg-footer">
				<AlertDialog.Cancel>
					{#snippet child({ props })}
						<Button variant="ghost" {...props} onclick={() => (open = false)}>
							{cancelLabel}
						</Button>
					{/snippet}
				</AlertDialog.Cancel>
				<AlertDialog.Action>
					{#snippet child({ props })}
						<Button
							variant={tone === 'danger' ? 'danger' : 'primary'}
							{...props}
							onclick={() => {
								onConfirm();
								open = false;
							}}
						>
							{confirmLabel}
						</Button>
					{/snippet}
				</AlertDialog.Action>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<style>
	:global(.fi-adlg-overlay) {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.45);
		z-index: 50;
	}

	:global(.fi-adlg-content) {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 51;
		width: min(440px, calc(100vw - var(--space-6)));
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elev-2);
		padding: var(--space-5);
	}

	:global(.fi-adlg-title) {
		font-family: var(--font-ui);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 var(--space-3);
	}

	:global(.fi-adlg-desc) {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-5);
	}

	:global(.fi-adlg-footer) {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
	}
</style>
