<script lang="ts">
	interface Props {
		blogSlug: string;
		slug: string;
		title: string;
		excerpt?: string;
		publishedAt?: string | Date;
		blogTitle?: string;
	}

	let { blogSlug, slug, title, excerpt, publishedAt, blogTitle }: Props = $props();

	const formattedDate = $derived.by(() => {
		if (!publishedAt) return null;
		try {
			const d = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
			if (isNaN(d.getTime())) return null;
			return d.toLocaleDateString();
		} catch {
			return null;
		}
	});

	const hasMeta = $derived(!!blogTitle || !!formattedDate);
</script>

<article class="post-card">
	<a class="post-title" href="/b/{blogSlug}/{slug}">{title}</a>
	{#if hasMeta}
		<p class="meta">
			{#if blogTitle}<span>{blogTitle}</span>{/if}
			{#if blogTitle && formattedDate}<span class="sep" aria-hidden="true">·</span>{/if}
			{#if formattedDate}<time>{formattedDate}</time>{/if}
		</p>
	{/if}
	{#if excerpt}
		<p class="excerpt">{excerpt}</p>
	{/if}
</article>

<style>
	.post-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		/* Anchor the stretched-link overlay below. */
		position: relative;
	}

	.post-title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--color-text);
		text-decoration: none;
		line-height: 1.3;
		transition: color var(--transition-fast) var(--ease);
	}

	/* Stretched link: the whole card is clickable via the title anchor, keeping a
	   single accessible link rather than nesting the card in an <a>. */
	.post-title::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.post-title:hover {
		color: var(--color-link);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin: 0;
	}

	.sep {
		color: var(--color-text-muted);
	}

	.excerpt {
		font-family: var(--font-standfirst);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
