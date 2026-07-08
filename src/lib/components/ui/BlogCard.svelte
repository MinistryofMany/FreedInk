<script lang="ts">
	import Card from './Card.svelte';

	interface Props {
		title: string;
		slug: string;
		description?: string;
		authorCount?: number;
		latestPostTitle?: string;
	}

	let { title, slug, description, authorCount, latestPostTitle }: Props = $props();
</script>

<Card>
	<div class="blog-card">
		<a class="blog-title" href="/b/{slug}">{title}</a>
		<p class="meta">
			{#if authorCount !== undefined}{authorCount} authors ·
			{/if}anonymous
		</p>
		{#if description}
			<p class="description">{description}</p>
		{/if}
		{#if latestPostTitle}
			<div class="latest">
				<span>Latest · "{latestPostTitle}"</span>
			</div>
		{/if}
	</div>
</Card>

<style>
	.blog-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		/* Anchor the stretched-link overlay below. */
		position: relative;
	}

	.blog-title {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		text-decoration: none;
		line-height: 1.25;
		transition: color var(--transition-fast) var(--ease);
	}

	/* Stretched link: the whole card is clickable via the title anchor, keeping a
	   single accessible link rather than nesting the card in an <a>. */
	.blog-title::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.blog-title:hover {
		color: var(--color-link);
	}

	.meta {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-accent);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0;
	}

	.description {
		font-family: var(--font-standfirst);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.5;
	}

	.latest {
		margin-top: var(--space-2);
		padding-top: var(--space-3);
		border-top: var(--border-1) solid var(--color-border);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
