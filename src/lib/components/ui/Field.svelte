<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	interface Props {
		label: string;
		id?: string;
		type?: string;
		multiline?: boolean;
		value?: string;
		required?: boolean;
		error?: string;
		help?: string;
		placeholder?: string;
		class?: string;
		maxlength?: number;
		minlength?: number;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		rows?: number;
	}
	let {
		label,
		id,
		type = 'text',
		multiline = false,
		value = $bindable(''),
		required = false,
		error,
		help,
		placeholder,
		class: klass = '',
		maxlength,
		minlength,
		autocomplete,
		rows
	}: Props = $props();

	// SSR-stable unique id (consistent across server render + hydration).
	const autoId = $props.id();
	const fieldId = $derived(id ?? autoId);
	const helpId = $derived(help ? `${fieldId}-help` : undefined);
	const errorId = $derived(error ? `${fieldId}-error` : undefined);
	const describedBy = $derived([helpId, errorId].filter(Boolean).join(' ') || undefined);
</script>

<div class="field {klass}">
	<label for={fieldId}
		>{label}{#if required}<span class="required" aria-hidden="true"> *</span>{/if}</label
	>
	{#if multiline}
		<textarea
			id={fieldId}
			bind:value
			{required}
			{placeholder}
			{maxlength}
			{minlength}
			{autocomplete}
			{rows}
			aria-invalid={error ? true : undefined}
			aria-describedby={describedBy}
		></textarea>
	{:else}
		<input
			id={fieldId}
			{type}
			bind:value
			{required}
			{placeholder}
			{maxlength}
			{minlength}
			{autocomplete}
			aria-invalid={error ? true : undefined}
			aria-describedby={describedBy}
		/>
	{/if}
	{#if help}
		<p id={helpId} class="help">{help}</p>
	{/if}
	{#if error}
		<p id={errorId} class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	label {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.required {
		color: var(--color-danger);
	}

	.help {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.error {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-danger);
	}
</style>
