<script lang="ts">
	import { page } from '$app/stores';
	import { Button, Kicker } from '$lib/components/ui';

	export let data;

	// Capability flags derived from the membership roles the layout load resolved
	// (a service operator arrives with a synthetic ['owner'] role, so they see the
	// full subnav). We only surface links the viewer can actually open, so a
	// reviewer-only member doesn't hit a section that would bounce them to /admin.
	$: roles = (data.roles ?? []) as string[];
	$: canManage = roles.includes('owner');
	$: canReview = roles.some((r) => r === 'owner' || r === 'editor' || r === 'reviewer');
	$: canWrite = roles.some((r) => r === 'owner' || r === 'editor' || r === 'author');
	$: canModerate = roles.some((r) => r === 'owner' || r === 'editor');

	$: base = `/admin/b/${data.blog.slug}`;
	$: current = $page.url.pathname;

	// Build the visible nav items in a stable order.
	$: items = [
		canManage && { href: `${base}/manage`, label: 'Manage' },
		canWrite && { href: `${base}/author`, label: 'Write' },
		canReview && { href: `${base}/review`, label: 'Review' },
		canModerate && { href: `${base}/posts`, label: 'Posts' },
		canManage && { href: `${base}/settings`, label: 'Settings' }
	].filter(Boolean) as Array<{ href: string; label: string }>;

	function isActive(href: string): boolean {
		return current === href || current.startsWith(href + '/');
	}
</script>

<div class="blog-admin">
	<div class="blog-admin__head">
		<Kicker>{data.blog.title}</Kicker>
		{#if data.isOperator}
			<span class="operator-badge" title="You are viewing this blog as a service operator"
				>Operator access</span
			>
		{/if}
	</div>
	{#if items.length > 0}
		<nav class="blog-subnav" aria-label="Blog admin sections">
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
		</nav>
	{/if}

	<div class="blog-admin__body">
		<slot></slot>
	</div>
</div>

<style>
	.blog-admin {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.blog-admin__head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.operator-badge {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-accent);
		border: var(--border-1) solid var(--color-accent);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-2);
	}

	.blog-subnav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		border-bottom: var(--border-1) solid var(--color-border);
		padding-bottom: var(--space-3);
	}

	.blog-admin__body {
		margin-top: var(--space-2);
	}
</style>
