<script lang="ts">
	import { getContext } from 'svelte';
	import { _ } from '$lib/i18n';
	import { Card, Kicker, EmptyState } from '$lib/components/ui';

	const owned = getContext<Array<{ slug: string; title: string }>>('owned');
	const edited = getContext<Array<{ slug: string; title: string }>>('edited');
	const reviewed = getContext<Array<{ slug: string; title: string }>>('reviewed');
	const authored = getContext<Array<{ slug: string; title: string }>>('authored');

	const groups = [
		{
			key: 'owned',
			heading: 'admin.owned_heading',
			empty: 'admin.no_owned',
			blogs: owned,
			href: (slug: string) => `/admin/b/${slug}/manage`
		},
		{
			key: 'edited',
			heading: 'admin.editing_heading',
			empty: 'admin.no_editing',
			blogs: edited,
			href: (slug: string) => `/admin/b/${slug}/review`
		},
		{
			key: 'reviewed',
			heading: 'admin.reviewing_heading',
			empty: 'admin.no_reviewing',
			blogs: reviewed,
			href: (slug: string) => `/admin/b/${slug}/review`
		},
		{
			key: 'authored',
			heading: 'admin.authoring_heading',
			empty: 'admin.no_authoring',
			blogs: authored,
			href: (slug: string) => `/admin/b/${slug}/author`
		}
	] as const;
</script>

<svelte:head>
	<title>{$_('admin.dashboard')} — FreedInk</title>
</svelte:head>

<div class="dashboard">
	{#each groups as group (group.key)}
		<Card>
			<Kicker>{$_(group.heading)}</Kicker>
			{#if group.blogs.length === 0}
				<EmptyState title={$_(group.empty)} />
			{:else}
				<ul class="blog-list">
					{#each group.blogs as blog (blog.slug)}
						<li><a href={group.href(blog.slug)}>{blog.title}</a></li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/each}
</div>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.blog-list {
		list-style: none;
		padding: 0;
		margin: var(--space-3) 0 0;
	}

	.blog-list li {
		padding: var(--space-1) 0;
		border-bottom: var(--border-1) solid var(--color-border);
	}

	.blog-list li:last-child {
		border-bottom: none;
	}

	.blog-list a {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-accent);
		text-decoration: none;
	}

	.blog-list a:hover {
		text-decoration: underline;
	}
</style>
