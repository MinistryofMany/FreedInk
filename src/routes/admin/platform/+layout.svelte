<script lang="ts">
	import { page } from '$app/stores';
	// Per-wave nav shim. The overview page (+page.svelte) carries its own
	// nav for the original three sections (overview / users / audit); this
	// layout-level strip surfaces the newer ones (flags / reports) so they
	// reachable from every platform sub-page without having to retrofit
	// the existing pages.
	$: path = $page.url.pathname;
</script>

<nav class="platform-nav">
	<a href="/admin/platform" class:active={path === '/admin/platform'}>Overview</a>
	<a href="/admin/platform/users" class:active={path.startsWith('/admin/platform/users')}>Users</a>
	<a href="/admin/platform/flags" class:active={path.startsWith('/admin/platform/flags')}>Flags</a>
	<a href="/admin/platform/reports" class:active={path.startsWith('/admin/platform/reports')}>
		Reports
	</a>
	<a href="/admin/platform/audit" class:active={path.startsWith('/admin/platform/audit')}>
		Audit log
	</a>
</nav>

<slot />

<style>
	.platform-nav {
		display: flex;
		gap: 0.75rem;
		padding: 0.5rem 0;
		margin-bottom: 1rem;
		border-bottom: 1px solid #eee;
		font-size: 0.9rem;
	}
	.platform-nav a {
		text-decoration: none;
		padding: 0.2rem 0.5rem;
		border-radius: 0.25rem;
	}
	.platform-nav a.active {
		background: #f0f0f0;
		font-weight: 600;
	}
</style>
