<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import { Button, EmptyState, Kicker, PostCard } from '$lib/components/ui';
	import type { PageData } from './$types';

	export let data: PageData;

	let acc: typeof data.results = data.results;
	let nextCursor: string | null = data.nextCursor;
	let lastSeenCursor: string | null = null;
	let loading = false;

	$: {
		const currentCursor = $page.url.searchParams.get('cursor');
		if (currentCursor === null) {
			acc = data.results;
			lastSeenCursor = null;
		} else if (currentCursor !== lastSeenCursor) {
			const seen = new Set(acc.map((r) => r.postId));
			acc = [...acc, ...data.results.filter((r) => !seen.has(r.postId))];
			lastSeenCursor = currentCursor;
		}
		nextCursor = data.nextCursor;
	}

	async function loadMore() {
		if (!nextCursor || loading) return;
		loading = true;
		try {
			const u = new URL($page.url);
			u.searchParams.set('cursor', nextCursor);
			await goto(u.pathname + u.search, {
				noScroll: true,
				keepFocus: true,
				replaceState: false
			});
		} finally {
			loading = false;
		}
	}
</script>

<div class="search-page">
	<header class="search-header">
		<Kicker>Search</Kicker>
		<h1 class="search-heading">{$_('search.heading')}</h1>
	</header>

	<form method="get" class="search-form">
		<input
			class="search-input"
			type="search"
			name="q"
			value={data.q}
			placeholder={$_('search.placeholder')}
		/>
		<select class="search-select" name="tag">
			<option value="">{$_('search.any_tag')}</option>
			{#each data.tags as t}
				<option value={t.slug} selected={t.slug === data.tag}>{t.name}</option>
			{/each}
		</select>
		<Button type="submit">{$_('search.submit')}</Button>
	</form>

	{#if acc.length === 0}
		<EmptyState title={$_('search.no_matches')} />
	{:else}
		<ul class="results" role="list">
			{#each acc as r (r.postId)}
				<li class="result-item">
					<PostCard
						blogSlug={r.blog.slug}
						slug={r.version.slug}
						title={r.version.title}
						excerpt={r.version.content.slice(0, 200) + (r.version.content.length > 200 ? '…' : '')}
						blogTitle={r.blog.title}
					/>
				</li>
			{/each}
		</ul>

		{#if nextCursor}
			<div class="load-more">
				<form method="get" action="/search" on:submit|preventDefault={loadMore}>
					{#if data.q}<input type="hidden" name="q" value={data.q} />{/if}
					{#if data.tag}<input type="hidden" name="tag" value={data.tag} />{/if}
					<input type="hidden" name="cursor" value={nextCursor} />
					<Button variant="ghost" type="submit" {loading} disabled={loading}>
						{loading ? $_('comments.loading') : $_('actions.load_more')}
					</Button>
				</form>
			</div>
		{/if}
	{/if}
</div>

<style>
	.search-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.search-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.search-heading {
		font-family: var(--font-display);
		font-size: var(--text-3xl);
		color: var(--color-text);
		line-height: 1.15;
		margin: 0;
	}

	.search-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}

	.search-input {
		flex: 1 1 16rem;
		min-width: 0;
		height: var(--touch-target);
		padding: 0 var(--space-3);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border-strong);
		border-radius: var(--radius-md);
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
	}

	.search-input:focus {
		border-color: var(--color-accent);
		outline: var(--focus-ring-width) solid var(--focus-ring-color);
		outline-offset: var(--focus-ring-offset);
	}

	.search-select {
		height: var(--touch-target);
		padding: 0 var(--space-3);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.search-select:focus {
		border-color: var(--color-accent);
		outline: var(--focus-ring-width) solid var(--focus-ring-color);
		outline-offset: var(--focus-ring-offset);
	}

	.results {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.result-item {
		padding-bottom: var(--space-5);
		border-bottom: var(--border-1) solid var(--color-border);
	}

	.result-item:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.load-more {
		display: flex;
		justify-content: center;
		padding-top: var(--space-4);
	}
</style>
