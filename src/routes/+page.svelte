<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import type { PageData } from './$types';

	export let data: PageData;

	// Accumulated list across "Load more" navigations within the same SPA
	// session. Reset when the URL cursor goes back to null (e.g. user clicked
	// the logo to land on /).
	let acc: typeof data.Blogs = data.Blogs;
	let nextCursor: string | null = data.nextCursor;
	let lastSeenCursor: string | null = null;
	let loading = false;

	// React to load data changes (forward "Load more" navigation appends;
	// fresh visits reset). We dedupe on the cursor that *produced* the page
	// — if cursor is null, this is page 1, replace acc.
	$: {
		const currentCursor = $page.url.searchParams.get('cursor');
		if (currentCursor === null) {
			acc = data.Blogs;
			lastSeenCursor = null;
		} else if (currentCursor !== lastSeenCursor) {
			// Append and dedupe by id in case of concurrent inserts.
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
			await goto(`/?cursor=${encodeURIComponent(nextCursor)}`, {
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
	<title>{$_('home.page_title')}</title>
	<meta property="og:type" content="website" />
	<meta property="og:title" content="FreedInk" />
	<meta property="og:description" content={$_('home.og_description')} />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<div class="jumbotron">
	<h2>{$_('home.welcome_heading')}</h2>
	<p>{$_('home.subhead')}</p>
	<a href="/signup" class="btn btn-primary">{$_('home.cta')}</a>
</div>
<div class="featured">
	<h2>{$_('home.featured_blogs')}</h2>
	<ul>
		{#each acc as Blog (Blog.id)}
			<li>
				<h2><a href={`/b/${Blog.slug}`}>{Blog.title}</a></h2>
			</li>
		{/each}
	</ul>
	{#if nextCursor}
		<form method="get" action="/" on:submit|preventDefault={loadMore} class="load-more">
			<input type="hidden" name="cursor" value={nextCursor} />
			<button type="submit" disabled={loading}>
				{loading ? $_('comments.loading') : $_('actions.load_more')}
			</button>
		</form>
	{/if}
</div>

<style>
	.jumbotron {
		padding: 4rem;
		margin-inline: auto;
		margin-bottom: 3rem;
		background-color: var(--color-green-lightest);
		border-radius: 0.5rem;
		text-align: center;
		max-width: 120ch;
	}

	.jumbotron h2 {
		font-size: 3rem;
		font-weight: bold;
	}

	.jumbotron p {
		font-size: 1.25rem;
		font-weight: 300;
	}

	.jumbotron .btn {
		padding: 0.75rem 1.25rem;
		margin: 1rem;
		font-size: 1.25rem;
		border-radius: 0.3rem;
	}

	.featured {
		margin-inline: auto;
		width: 100%;
		max-width: 120ch;
	}

	p {
		padding-inline: 2rem;
		padding-bottom: 1.5rem;
	}

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
