<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import { BlogCard, Button, Kicker } from '$lib/components/ui';
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

<section class="hero">
	<Kicker>Anonymous collective blogging</Kicker>
	<h1>Put your name on the masthead. Never on the post.</h1>
	<p class="dek">
		A group founds a blog together. Everyone's name is on it. No one - not even the others - can
		prove who wrote which piece.
	</p>
	<div class="ctas">
		<Button href="/signup">Start a collective</Button>
		<Button variant="ghost" href="/b">Browse blogs</Button>
	</div>
</section>

<section class="featured">
	<Kicker>Featured collectives</Kicker>
	<div class="grid">
		{#each acc as Blog (Blog.id)}
			<BlogCard title={Blog.title} slug={Blog.slug} description={Blog.description ?? undefined} />
		{/each}
	</div>
	{#if nextCursor}
		<form method="get" action="/" on:submit|preventDefault={loadMore} class="load-more">
			<input type="hidden" name="cursor" value={nextCursor} />
			<Button variant="ghost" type="submit" disabled={loading}>
				{loading ? $_('comments.loading') : $_('actions.load_more')}
			</Button>
		</form>
	{/if}
</section>

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-4);
		padding-block: var(--space-12);
		padding-inline: var(--space-4);
		max-width: 60ch;
		margin-inline: auto;
	}

	.hero h1 {
		font-family: var(--font-display);
		font-size: var(--text-4xl);
		font-weight: 700;
		line-height: 1.15;
		color: var(--color-text);
		margin: 0;
	}

	.dek {
		font-family: var(--font-standfirst);
		font-size: var(--text-lg);
		color: var(--color-text-muted);
		line-height: 1.6;
		margin: 0;
	}

	.ctas {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		justify-content: center;
		margin-top: var(--space-2);
	}

	.featured {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 120ch;
		margin-inline: auto;
		padding-inline: var(--space-4);
		padding-bottom: var(--space-12);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-4);
	}

	.load-more {
		display: flex;
		justify-content: center;
		margin-top: var(--space-4);
	}
</style>
