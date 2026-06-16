<script lang="ts">
	import { page } from '$app/stores';
	import { Kicker } from '$lib/components/ui';
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
		<Kicker>Legal</Kicker>
		<nav aria-label="Legal pages">
			<ul>
				{#each links as l}
					<li>
						<a href={l.href} aria-current={current === l.href ? 'page' : undefined}>{l.label}</a>
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
		gap: var(--space-8);
		max-width: 90ch;
		margin: var(--space-5) auto;
		padding: 0 var(--space-5);
	}

	aside {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		border-right: var(--border-1) solid var(--color-border);
		padding-right: var(--space-5);
	}

	aside ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	aside a {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-decoration: none;
		display: block;
		padding: var(--space-1) 0;
		transition: color var(--transition-fast) var(--ease);
	}

	aside a:hover {
		color: var(--color-accent);
	}

	aside a[aria-current='page'] {
		color: var(--color-accent);
		font-weight: 600;
	}

	article {
		max-width: 70ch;
		line-height: 1.6;
		font-family: var(--font-standfirst);
		font-size: var(--text-base);
		color: var(--color-text);
	}

	article :global(h1) {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		color: var(--color-text);
		margin: 0 0 var(--space-5);
		line-height: 1.2;
	}

	article :global(h2) {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		margin: var(--space-6) 0 var(--space-3);
	}

	article :global(h3) {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--color-text);
		margin: var(--space-5) 0 var(--space-2);
	}

	article :global(p) {
		margin: 0 0 var(--space-4);
	}

	article :global(blockquote) {
		border-left: var(--border-2) solid var(--color-border-strong);
		padding-left: var(--space-4);
		color: var(--color-text-muted);
		background: var(--color-surface-alt);
		margin: var(--space-4) 0;
		padding-top: var(--space-3);
		padding-bottom: var(--space-3);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	article :global(pre) {
		background: var(--color-surface-alt);
		padding: var(--space-4);
		overflow-x: auto;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		margin: var(--space-4) 0;
	}

	article :global(table) {
		border-collapse: collapse;
		margin: var(--space-4) 0;
		width: 100%;
	}

	article :global(th),
	article :global(td) {
		border: var(--border-1) solid var(--color-border);
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-size: var(--text-sm);
	}

	article :global(th) {
		background: var(--color-surface-alt);
		font-family: var(--font-ui);
		font-weight: 600;
	}

	article :global(a) {
		color: var(--color-link);
	}

	article :global(a:hover) {
		color: var(--color-link-hover);
	}

	@media (max-width: 720px) {
		.legal-wrap {
			grid-template-columns: 1fr;
			gap: var(--space-5);
		}

		aside {
			border-right: none;
			border-bottom: var(--border-1) solid var(--color-border);
			padding-right: 0;
			padding-bottom: var(--space-4);
		}

		aside ul {
			flex-direction: row;
			flex-wrap: wrap;
			gap: var(--space-3);
		}
	}
</style>
