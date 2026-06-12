<script lang="ts">
	import { page } from '$app/stores';
	const links = [
		{ href: '/legal/privacy', label: 'Privacy' },
		{ href: '/legal/terms', label: 'Terms' },
		{ href: '/legal/dmca', label: 'DMCA' },
		{ href: '/legal/data-rights', label: 'Data rights' }
	];
	$: current = $page.url.pathname;
</script>

<div class="legal-wrap">
	<aside>
		<h3>Legal</h3>
		<nav>
			<ul>
				{#each links as l}
					<li>
						<a href={l.href} class:active={current === l.href}>{l.label}</a>
					</li>
				{/each}
			</ul>
		</nav>
	</aside>
	<article>
		<slot></slot>
	</article>
</div>

<style>
	.legal-wrap {
		display: grid;
		grid-template-columns: 16rem 1fr;
		gap: 2rem;
		max-width: 90ch;
		margin: 1rem auto;
		padding: 0 1rem;
	}
	aside {
		border-right: 1px solid var(--color-green-light);
		padding-right: 1rem;
	}
	aside h3 {
		margin-top: 0;
	}
	aside ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	aside li {
		margin: 0.25rem 0;
	}
	aside a.active {
		font-weight: 700;
	}
	article {
		max-width: 70ch;
		line-height: 1.55;
	}
	article :global(h1) {
		margin-top: 0;
	}
	article :global(h2) {
		margin-top: 2rem;
	}
	article :global(blockquote) {
		border-left: 3px solid var(--color-green-light);
		padding-left: 0.75rem;
		color: var(--color-green-dark);
		background: var(--color-green-white);
	}
	article :global(pre) {
		background: var(--color-green-white);
		padding: 0.75rem;
		overflow-x: auto;
		border-radius: 0.25rem;
	}
	article :global(table) {
		border-collapse: collapse;
		margin: 0.75rem 0;
	}
	article :global(th),
	article :global(td) {
		border: 1px solid var(--color-green-light);
		padding: 0.35rem 0.5rem;
		text-align: left;
	}
	@media (max-width: 720px) {
		.legal-wrap {
			grid-template-columns: 1fr;
		}
		aside {
			border-right: 0;
			border-bottom: 1px solid var(--color-green-light);
			padding: 0 0 0.5rem;
		}
		aside ul {
			display: flex;
			flex-wrap: wrap;
			gap: 0.75rem;
		}
		aside li {
			margin: 0;
		}
	}
</style>
