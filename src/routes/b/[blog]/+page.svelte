<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import { PostCard, Button, Byline, Rule } from '$lib/components/ui';
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

<div class="blog-page">
	<header class="masthead">
		<h1 class="blog-title">{data.Blog.title}</h1>
		{#if data.Blog.description}
			<p class="blog-description">{data.Blog.description}</p>
		{/if}

		<div class="contributors">
			<Byline author={data.Blog.title} meta={[`${data.Blog.authors.length} authors · anonymous`]} />
			<p class="author-names">
				{data.Blog.authors.join(', ')}
			</p>
			<p class="contributors-note">{$_('blog.contributors_note')}</p>
		</div>
	</header>

	<Rule />

	<section class="posts-section" aria-labelledby="posts-heading">
		<h2 class="posts-heading" id="posts-heading">{$_('blog.posts_heading')}</h2>
		<ul class="post-list" role="list">
			{#each acc as Post (Post.id)}
				<li class="post-item">
					<PostCard
						blogSlug={data.Blog.slug}
						slug={Post.slug}
						title={Post.title}
						excerpt={Post.content}
						publishedAt={Post.published_at ?? undefined}
					/>
				</li>
			{/each}
		</ul>

		{#if nextCursor}
			<div class="load-more">
				<form method="get" action={`/b/${data.Blog.slug}`} on:submit|preventDefault={loadMore}>
					<input type="hidden" name="cursor" value={nextCursor} />
					<Button variant="ghost" type="submit" {loading} disabled={loading}>
						{loading ? $_('comments.loading') : $_('actions.load_more')}
					</Button>
				</form>
			</div>
		{/if}
	</section>
</div>

<style>
	.blog-page {
		display: flex;
		flex-direction: column;
	}

	.masthead {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.blog-title {
		font-family: var(--font-display);
		font-size: var(--text-4xl);
		color: var(--color-text);
		line-height: 1.1;
		margin: 0;
	}

	.blog-description {
		font-family: var(--font-standfirst);
		font-size: var(--text-lg);
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.5;
		max-width: 64ch;
	}

	.contributors {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.author-names {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.contributors-note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.posts-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.posts-heading {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		margin: 0;
	}

	.post-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.post-item {
		padding-bottom: var(--space-6);
		border-bottom: 1px solid var(--color-border);
	}

	.post-item:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.load-more {
		display: flex;
		justify-content: center;
		padding-top: var(--space-4);
	}
</style>
