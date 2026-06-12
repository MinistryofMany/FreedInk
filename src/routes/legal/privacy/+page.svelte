<script lang="ts">
	import type { PageData } from './$types';
	export let data: PageData;
</script>

<svelte:head>
	<title>{data.title} — FreedInk</title>
	<meta name="description" content="How FreedInk handles your data." />
	<meta property="og:title" content="{data.title} — FreedInk" />
	<meta property="og:description" content="How FreedInk handles your data." />
	<meta property="og:type" content="article" />
</svelte:head>

{@html data.html}
