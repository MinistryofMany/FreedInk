<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import type { PageData } from './$types';

	export let data: PageData;
	$: ogDescription = data.Blog.description || `Posts from ${data.Blog.title} on FreedInk.`;

	let acc: typeof data.Posts = data.Posts;
	let nextCursor: string | null = data.nextCursor;
	let lastSeenCursor: string | null = null;
	let loading = false;

	$: {
		const currentCursor = $page.url.searchParams.get('cursor');
		if (currentCursor === null) {
			acc = data.Posts;
			lastSeenCursor = null;
		} else if (currentCursor !== lastSeenCursor) {
			const seen = new Set(acc.map((p) => p.id));
			acc = [...acc, ...data.Posts.filter((p) => !seen.has(p.id))];
			lastSeenCursor = currentCursor;
		}
		nextCursor = data.nextCursor;
	}

	async function loadMore() {
		if (!nextCursor || loading) return;
		loading = true;
		try {
			await goto(`/b/${data.Blog.slug}?cursor=${encodeURIComponent(nextCursor)}`, {
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
	<title>{data.Blog.title} — FreedInk</title>
	<meta name="description" content={ogDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={data.Blog.title} />
	<meta property="og:description" content={ogDescription} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={data.Blog.title} />
	<meta name="twitter:description" content={ogDescription} />
	<link
		rel="alternate"
		type="application/rss+xml"
		title="{data.Blog.title} (RSS)"
		href="/b/{data.Blog.slug}/feed.xml"
	/>
</svelte:head>

<h1>{data.Blog.title}</h1>
<code>{data.Blog.description}</code>

<section id="contributors">
	<h4>{$_('blog.contributors_heading')}</h4>
	<div id="authors">
		{#each data.Blog.authors as author}
			<div>{author}</div>
		{/each}
	</div>
	<p class="contributors-note">{$_('blog.contributors_note')}</p>
</section>
<h3>{$_('blog.posts_heading')}</h3>
<ul>
	{#each acc as Post (Post.id)}
		<li>
			<h2>
				<a href={`/b/${data.Blog.slug}/${Post.slug}`}>{Post.title}</a>
			</h2>
			<div class="post_short">{Post.content}</div>
		</li>
	{/each}
</ul>
{#if nextCursor}
	<form
		method="get"
		action={`/b/${data.Blog.slug}`}
		on:submit|preventDefault={loadMore}
		class="load-more"
	>
		<input type="hidden" name="cursor" value={nextCursor} />
		<button type="submit" disabled={loading}>
			{loading ? $_('comments.loading') : $_('actions.load_more')}
		</button>
	</form>
{/if}

<style>
	ul {
		list-style-type: none;
		padding: 0;
		margin: 0;
	}
	div#authors {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	div#authors div:not(:last-child)::after {
		content: ',';
	}

	.contributors-note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		margin: 0.25rem 0 0;
	}

	.post_short {
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow: hidden;
		max-width: 120ch;
	}
	.load-more {
		margin-top: 1rem;
		text-align: center;
	}
</style>
