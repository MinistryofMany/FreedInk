<script lang="ts">
	import { page } from '$app/stores';
	import { Button, Kicker, Wordmark } from '$lib/components/ui';

	export let data;

	$: current = $page.url.pathname;
	const items = [
		{ href: '/admin/ops', label: 'Overview' },
		{ href: '/admin/ops/reports', label: 'Reports' }
	];
	function isActive(href: string): boolean {
		return href === '/admin/ops' ? current === href : current.startsWith(href);
	}
</script>

<header class="ops-header">
	<div class="ops-header__top">
		<div class="ops-header__brand">
			<Wordmark href="/" />
			<Kicker>Operator</Kicker>
		</div>
		<p class="ops-header__greeting">
			Signed in as {data.operator.displayName ?? data.operator.username}
		</p>
	</div>
	<nav class="ops-nav" aria-label="Operator sections">
		{#each items as item (item.href)}
			<Button
				href={item.href}
				variant={isActive(item.href) ? 'primary' : 'ghost'}
				size="sm"
				aria-current={isActive(item.href) ? 'page' : undefined}
			>
				{item.label}
			</Button>
		{/each}
		<Button href="/admin" variant="ghost" size="sm">Back to admin</Button>
	</nav>
</header>

<slot></slot>

<style>
	.ops-header {
		border-bottom: var(--border-1) solid var(--color-border);
		padding-bottom: var(--space-3);
		margin-bottom: var(--space-5);
	}
	.ops-header__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-3);
	}
	.ops-header__brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.ops-header__greeting {
		font-family: var(--font-display);
		font-size: var(--text-base);
		color: var(--color-text-muted);
		margin: 0;
	}
	.ops-nav {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
