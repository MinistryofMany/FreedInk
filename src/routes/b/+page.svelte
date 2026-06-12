<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
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

<h2>{$_('blog.featured_heading')}</h2>
<ul>
	{#each acc as Blog (Blog.id)}
		<li>
			<h2><a href={`/b/${Blog.slug}`}>{Blog.title}</a></h2>
			<p>{Blog.description}</p>
		</li>
	{/each}
</ul>
{#if nextCursor}
	<form method="get" action="/b" on:submit|preventDefault={loadMore} class="load-more">
		<input type="hidden" name="cursor" value={nextCursor} />
		<button type="submit" disabled={loading}>
			{loading ? $_('comments.loading') : $_('actions.load_more')}
		</button>
	</form>
{/if}

<style>
	li {
		margin-bottom: 1rem;
	}
	ul {
		list-style-type: none;
		padding: 0;
	}
	.load-more {
		margin-top: 1rem;
		text-align: center;
	}
</style>
