<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		options: Option[];
		value?: string;
		ariaLabel: string;
		class?: string;
	}

	let { options, value = $bindable<string>(), ariaLabel, class: klass = '' }: Props = $props();

	// Roving tabindex: only the selected radio is tabbable, and arrow keys move
	// both selection and DOM focus (focus follows selection within the group).
	function handleKeydown(e: KeyboardEvent, idx: number) {
		const last = options.length - 1;
		let next: number | null = null;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = idx === 0 ? last : idx - 1;
		else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = idx === last ? 0 : idx + 1;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = last;
		if (next === null) return;
		e.preventDefault();
		value = options[next].value;
		const group = (e.currentTarget as HTMLElement).parentElement;
		group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<div class="segmented {klass}" role="radiogroup" aria-label={ariaLabel}>
	{#each options as opt, idx (opt.value)}
		<button
			type="button"
			role="radio"
			aria-checked={value === opt.value}
			tabindex={value === opt.value || (value === undefined && idx === 0) ? 0 : -1}
			class="segment"
			class:selected={value === opt.value}
			onclick={() => (value = opt.value)}
			onkeydown={(e) => handleKeydown(e, idx)}>{opt.label}</button
		>
	{/each}
</div>

<style>
	.segmented {
		display: inline-flex;
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.segment {
		flex: 1;
		padding: 0 var(--space-3);
		min-height: 2rem;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 500;
		background: transparent;
		color: var(--color-text);
		border: none;
		border-left: var(--border-1) solid var(--color-border);
		cursor: pointer;
		transition:
			background var(--transition-fast) var(--ease),
			color var(--transition-fast) var(--ease);
	}

	.segment:first-child {
		border-left: none;
	}

	.segment.selected {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.segment:not(.selected):hover {
		background: var(--color-surface-alt);
	}
</style>
