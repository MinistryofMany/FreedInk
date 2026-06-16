<script lang="ts">
	interface Props {
		value?: number;
		min: number;
		max: number;
		step?: number;
		format?: (n: number) => string;
		ariaLabel: string;
		class?: string;
	}

	let {
		value = $bindable<number>(),
		min,
		max,
		step = 1,
		format,
		ariaLabel,
		class: klass = ''
	}: Props = $props();

	const display = $derived(format ? format(value ?? min) : String(value ?? min));
	const atMin = $derived((value ?? min) <= min);
	const atMax = $derived((value ?? min) >= max);

	function decrement() {
		value = Math.max(min, (value ?? min) - step);
	}

	function increment() {
		value = Math.min(max, (value ?? min) + step);
	}
</script>

<div class="stepper {klass}" aria-label={ariaLabel}>
	<button class="step-btn" onclick={decrement} disabled={atMin} aria-label="Decrease">A−</button>
	<span class="value" aria-live="polite">{display}</span>
	<button class="step-btn" onclick={increment} disabled={atMax} aria-label="Increase">A+</button>
</div>

<style>
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.step-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--space-2);
		min-height: 2rem;
		min-width: 2.5rem;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		background: var(--color-surface-alt);
		color: var(--color-text);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--transition-fast) var(--ease);
	}

	.step-btn:hover:not(:disabled) {
		background: var(--color-border);
	}

	.step-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.value {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		min-width: 3rem;
		text-align: center;
	}
</style>
