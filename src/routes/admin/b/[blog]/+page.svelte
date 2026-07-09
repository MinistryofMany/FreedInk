<!--
	This index never renders: +page.server.ts always redirects to the first
	section the viewer can use. Kept as a minimal fallback so the route resolves.
-->
<svelte:head>
	<title>Redirecting… — FreedInk</title>
</svelte:head>

<p class="redirecting">Redirecting…</p>

<style>
	.redirecting {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
</style>
