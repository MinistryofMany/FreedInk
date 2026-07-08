<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { Card, Button, Badge, Kicker, EmptyState } from '$lib/components/ui';

	export let data;

	let posts: typeof data.posts = data.posts;
	let nextCursor: string | null = data.nextCursor;
	let lastSeenCursor: string | null = null;
	let loadingMore = false;

	$: {
		const c = $page.url.searchParams.get('cursor');
		if (c === null) {
			posts = data.posts;
			lastSeenCursor = null;
		} else if (c !== lastSeenCursor) {
			const seen = new Set(posts.map((p) => p.id));
			posts = [...posts, ...data.posts.filter((p) => !seen.has(p.id))];
			lastSeenCursor = c;
		}
		nextCursor = data.nextCursor;
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const u = new URL($page.url);
			u.searchParams.set('cursor', nextCursor);
			await goto(u.pathname + u.search, { noScroll: true, keepFocus: true, replaceState: false });
		} finally {
			loadingMore = false;
		}
	}

	function tone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
		if (status === 'published') return 'success';
		if (status === 'under_review') return 'warning';
		if (status === 'rejected') return 'danger';
		return 'neutral';
	}
</script>

<svelte:head>
	<title>Posts — {data.blog.title}</title>
</svelte:head>

<div class="wrap">
	<header class="head">
		<Kicker>Posts</Kicker>
		<h1 class="heading">{data.blog.title}</h1>
		<p class="note">Every post in this blog. Open one to view its versions, comments, and moderation actions.</p>
	</header>

	{#if posts.length === 0}
		<EmptyState title="No posts yet." />
	{:else}
		<ul class="post-list">
			{#each posts as p (p.id)}
				<li>
					<Card padding="md" class="post-row">
						<div class="row-main">
							<a class="post-title" href="/admin/b/{data.blog.slug}/posts/{p.id}">{p.title}</a>
							<div class="meta">
								<Badge tone={tone(p.status)}>{p.status}</Badge>
								<span class="date">{new Date(p.createdAt).toLocaleDateString()}</span>
							</div>
						</div>
						<div class="row-actions">
							{#if p.status === 'published' && p.slug}
								<Button href="/b/{data.blog.slug}/{p.slug}" variant="ghost" size="sm">View</Button>
							{/if}
							<Button href="/admin/b/{data.blog.slug}/posts/{p.id}" variant="ghost" size="sm">
								Moderate
							</Button>
						</div>
					</Card>
				</li>
			{/each}
		</ul>

		{#if nextCursor}
			<div class="load-more">
				<Button variant="ghost" disabled={loadingMore} onclick={loadMore}>
					{loadingMore ? 'Loading…' : 'Load more'}
				</Button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.heading {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}
	.note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
		max-width: 60ch;
	}
	.post-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	:global(.post-row) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.row-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.post-title {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--color-link);
		text-decoration: none;
	}
	.post-title:hover {
		text-decoration: underline;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.date {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.row-actions {
		display: flex;
		gap: var(--space-2);
	}
	.load-more {
		text-align: center;
		margin-top: var(--space-3);
	}
</style>
