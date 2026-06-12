<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
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

<h2>{$_('search.heading')}</h2>
<form method="get">
	<input type="search" name="q" value={data.q} placeholder={$_('search.placeholder')} />
	<select name="tag">
		<option value="">{$_('search.any_tag')}</option>
		{#each data.tags as t}
			<option value={t.slug} selected={t.slug === data.tag}>{t.name}</option>
		{/each}
	</select>
	<button type="submit">{$_('search.submit')}</button>
</form>

{#if acc.length === 0}
	<p>{$_('search.no_matches')}</p>
{:else}
	<ul>
		{#each acc as r (r.postId)}
			<li>
				<a href={`/b/${r.blog.slug}/${r.version.slug}`}>
					<strong>{r.version.title}</strong>
				</a>
				<small> · {r.blog.title}</small>
				<p class="snippet">
					{r.version.content.slice(0, 200)}{r.version.content.length > 200 ? '…' : ''}
				</p>
			</li>
		{/each}
	</ul>
	{#if nextCursor}
		<form
			method="get"
			action="/search"
			on:submit|preventDefault={loadMore}
			class="load-more"
		>
			{#if data.q}<input type="hidden" name="q" value={data.q} />{/if}
			{#if data.tag}<input type="hidden" name="tag" value={data.tag} />{/if}
			<input type="hidden" name="cursor" value={nextCursor} />
			<button type="submit" disabled={loading}>
				{loading ? $_('comments.loading') : $_('actions.load_more')}
			</button>
		</form>
	{/if}
{/if}

<style>
	form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		margin-bottom: 1rem;
	}
	.snippet {
		color: var(--color-green-dark);
		font-size: 0.9rem;
	}
	.load-more {
		margin-top: 1rem;
		text-align: center;
	}
</style>
