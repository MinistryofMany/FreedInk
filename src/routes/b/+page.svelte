<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import { BlogCard, Button, Kicker } from '$lib/components/ui';
	import type { PageData } from './$types';

	export let data: PageData;

	let acc: typeof data.Blogs = data.Blogs;
	let nextCursor: string | null = data.nextCursor;
	let lastSeenCursor: string | null = null;
	let loading = false;

	$: {
		const currentCursor = $page.url.searchParams.get('cursor');
		if (currentCursor === null) {
			acc = data.Blogs;
			lastSeenCursor = null;
		} else if (currentCursor !== lastSeenCursor) {
			const seen = new Set(acc.map((b) => b.id));
			acc = [...acc, ...data.Blogs.filter((b) => !seen.has(b.id))];
			lastSeenCursor = currentCursor;
		}
		nextCursor = data.nextCursor;
	}

	async function loadMore() {
		if (!nextCursor || loading) return;
		loading = true;
		try {
			await goto(`/b?cursor=${encodeURIComponent(nextCursor)}`, {
				noScroll: true,
				keepFocus: true,
				replaceState: false
			});
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Collectives — FreedInk</title>
</svelte:head>

<div class="directory">
	<header class="directory-header">
		<Kicker>Collectives</Kicker>
		<h1 class="directory-heading">{$_('blog.featured_heading')}</h1>
		<p class="directory-dek">
			Anonymous writing collectives — open to readers, closed to surveillance.
		</p>
	</header>

	<ul class="blog-grid" role="list">
		{#each acc as Blog (Blog.id)}
			<li>
				<BlogCard title={Blog.title} slug={Blog.slug} description={Blog.description ?? undefined} />
			</li>
		{/each}
	</ul>

	{#if nextCursor}
		<div class="load-more">
			<form method="get" action="/b" on:submit|preventDefault={loadMore}>
				<input type="hidden" name="cursor" value={nextCursor} />
				<Button variant="ghost" type="submit" {loading} disabled={loading}>
					{loading ? $_('comments.loading') : $_('actions.load_more')}
				</Button>
			</form>
		</div>
	{/if}
</div>

<style>
	.directory {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.directory-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.directory-heading {
		font-family: var(--font-display);
		font-size: var(--text-3xl);
		color: var(--color-text);
		line-height: 1.15;
		margin: 0;
	}

	.directory-dek {
		font-family: var(--font-standfirst);
		font-size: var(--text-base);
		color: var(--color-text-muted);
		margin: 0;
		max-width: 56ch;
	}

	.blog-grid {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-4);
	}

	.load-more {
		display: flex;
		justify-content: center;
		padding-top: var(--space-4);
	}
</style>
