<script lang="ts">
	import { setContext } from 'svelte';
	import { _ } from '$lib/i18n';
	export let data;
	setContext('user', data.user);
	setContext('owned', data.ownedBlogs);
	setContext('edited', data.editedBlogs);
	setContext('reviewed', data.reviewedBlogs);
	setContext('authored', data.authoredBlogs);
</script>

<div id="header">
	<h3>{$_('admin.welcome', { values: { name: data.user.displayName ?? data.user.username } })}</h3>
	<nav>
		<a href="/admin/" class="btn">{$_('admin.dashboard')}</a>
		<a href="/admin/new" class="btn">{$_('admin.create_new_blog')}</a>
		<a href="/settings" class="btn">{$_('admin.settings')}</a>
	</nav>
</div>

<slot></slot>

<style>
	#header,
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	#header {
		margin-bottom: 0.5rem;
	}
</style>
