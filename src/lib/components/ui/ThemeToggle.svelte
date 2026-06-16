<script lang="ts">
	import { untrack } from 'svelte';
	import Sun from 'phosphor-svelte/lib/Sun';
	import Moon from 'phosphor-svelte/lib/Moon';
	import Monitor from 'phosphor-svelte/lib/Monitor';
	import { applyTheme } from '$lib/theme';

	type Theme = 'light' | 'dark' | 'auto';

	interface Props {
		initial?: 'light' | 'dark' | null;
	}
	let { initial = null }: Props = $props();

	// untrack breaks the reactive dependency so the $state seed is read once only.
	let mode = $state<Theme>(untrack(() => initial ?? 'auto'));

	const next: Record<Theme, Theme> = { light: 'dark', dark: 'auto', auto: 'light' };

	const nextLabel: Record<Theme, string> = {
		light: 'Switch to dark theme',
		dark: 'Switch to auto theme',
		auto: 'Switch to light theme'
	};

	function advance() {
		const n = next[mode];
		mode = n;
		applyTheme(n);
	}
</script>

<button type="button" class="theme-toggle" aria-label={nextLabel[mode]} onclick={advance}>
	{#if mode === 'light'}
		<Sun size="1.1em" />
	{:else if mode === 'dark'}
		<Moon size="1.1em" />
	{:else}
		<Monitor size="1.1em" />
	{/if}
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: var(--color-text);
		border: none;
		border-radius: var(--radius-sm);
		min-width: var(--touch-target);
		min-height: var(--touch-target);
		cursor: pointer;
		transition: background var(--transition-fast) var(--ease);
	}
	.theme-toggle:hover {
		background: var(--color-surface-alt);
	}
</style>
