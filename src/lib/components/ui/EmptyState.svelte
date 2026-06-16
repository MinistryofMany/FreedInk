<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	interface Props {
		// Accepts any Phosphor icon component (or any Svelte component with a size prop).
		icon?: Component<{ size?: string | number; color?: string }>;
		title: string;
		description?: string;
		action?: Snippet;
		class?: string;
	}
	let { icon, title, description, action, class: klass = '' }: Props = $props();
</script>

<div class={['empty-state', klass].filter(Boolean).join(' ')}>
	{#if icon}
		{@const Icon = icon}
		<Icon size="2rem" color="var(--color-text-muted)" />
	{/if}
	<p class="empty-title">{title}</p>
	{#if description}
		<p class="empty-description">{description}</p>
	{/if}
	{#if action}
		{@render action()}
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: var(--space-6);
		gap: var(--space-3);
	}
	.empty-title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--color-text);
		margin: 0;
	}
	.empty-description {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}
</style>
