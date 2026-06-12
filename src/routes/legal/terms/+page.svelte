<script lang="ts">
	import type { PageData } from './$types';
	export let data: PageData;
</script>

<svelte:head>
	<title>{data.title} — FreedInk</title>
	<meta name="description" content="Terms of Service for FreedInk." />
	<meta property="og:title" content="{data.title} — FreedInk" />
	<meta property="og:description" content="Terms of Service for FreedInk." />
	<meta property="og:type" content="article" />
</svelte:head>

<!-- data.html is our own legal markdown rendered server-side by renderMarkdown
     (marked + DOMPurify allowlist sanitize, src/lib/server/markdown.ts). -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html data.html}
