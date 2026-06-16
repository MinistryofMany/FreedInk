<script lang="ts">
	import { setContext } from 'svelte';
	import { _ } from '$lib/i18n';
	import { Button, Kicker, Wordmark } from '$lib/components/ui';
	export let data;
	setContext('user', data.user);
	setContext('owned', data.ownedBlogs);
	setContext('edited', data.editedBlogs);
	setContext('reviewed', data.reviewedBlogs);
	setContext('authored', data.authoredBlogs);
</script>

<header class="admin-header">
	<div class="admin-header__top">
		<div class="admin-header__brand">
			<Wordmark href="/" />
			<Kicker>Admin</Kicker>
		</div>
		<p class="admin-header__greeting">
			{$_('admin.welcome', { values: { name: data.user.displayName ?? data.user.username } })}
		</p>
	</div>
	<nav class="admin-nav">
		<Button href="/admin/" variant="ghost" size="sm">{$_('admin.dashboard')}</Button>
		<Button href="/admin/new" variant="ghost" size="sm">{$_('admin.create_new_blog')}</Button>
		<Button href="/settings" variant="ghost" size="sm">{$_('admin.settings')}</Button>
	</nav>
</header>

<slot></slot>

<style>
	.admin-header {
		border-bottom: var(--border-1) solid var(--color-border);
		padding-bottom: var(--space-3);
		margin-bottom: var(--space-5);
	}

	.admin-header__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-3);
	}

	.admin-header__brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.admin-header__greeting {
		font-family: var(--font-display);
		font-size: var(--text-base);
		color: var(--color-text-muted);
		margin: 0;
	}

	.admin-nav {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
