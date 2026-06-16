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

	function select(opt: string) {
		value = opt;
	}

	function handleKeydown(e: KeyboardEvent, idx: number) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			e.preventDefault();
			const prev = (idx - 1 + options.length) % options.length;
			value = options[prev].value;
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			e.preventDefault();
			const next = (idx + 1) % options.length;
			value = options[next].value;
		}
	}
</script>

<div class="segmented {klass}" role="radiogroup" aria-label={ariaLabel}>
	{#each options as opt, idx}
		<button
			role="radio"
			aria-checked={value === opt.value}
			class="segment"
			class:selected={value === opt.value}
			onclick={() => select(opt.value)}
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
