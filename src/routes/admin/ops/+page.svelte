<script lang="ts">
	import { Card, Button, Badge, Kicker, EmptyState } from '$lib/components/ui';

	export let data;

	let copied = false;
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard can be unavailable (insecure context / denied permission).
			// Leave the value visible for manual copy; don't swallow silently in a
			// way that looks like success.
			copied = false;
		}
	}

	$: subjects = data.operator.subjects;
</script>

<svelte:head>
	<title>Operator overview — FreedInk</title>
</svelte:head>

<div class="wrap">
	<!-- Identity card: how the operator finds the value for FREEDINK_OPERATOR_SUBS -->
	<Card>
		<Kicker>Your operator identity</Kicker>
		<h2 class="heading">Minister subject</h2>
		{#if subjects.length === 0}
			<p class="note">
				This account has no linked Minister identity, so it has no subject to allowlist. Sign in
				with Minister to get one.
			</p>
		{:else}
			<p class="note">
				This is the value to put in <code>FREEDINK_OPERATOR_SUBS</code> (comma-separated) to grant
				operator access. It never changes for your account.
			</p>
			<ul class="sub-list">
				{#each subjects as s (s.subject)}
					<li>
						<code class="sub">{s.subject}</code>
						<Button variant="ghost" size="sm" onclick={() => copy(s.subject)}>
							{copied ? 'Copied' : 'Copy'}
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if !data.allowlistConfigured}
			<p class="warn" role="alert">
				FREEDINK_OPERATOR_SUBS is not set on this deploy. Operator access is currently closed — set
				it to your subject above and redeploy.
			</p>
		{/if}
	</Card>

	<!-- Reports shortcut -->
	<Card>
		<div class="reports-row">
			<div>
				<Kicker>Moderation</Kicker>
				<h2 class="heading">Reports queue</h2>
				<p class="note">Abuse reports across every blog.</p>
			</div>
			<div class="reports-cta">
				{#if data.openReportCount > 0}
					<Badge tone="warning">{data.openReportCount} open</Badge>
				{/if}
				<Button href="/admin/ops/reports" variant="ghost" size="sm">Open reports</Button>
			</div>
		</div>
	</Card>

	<!-- All blogs -->
	<Card>
		<Kicker>All blogs</Kicker>
		<h2 class="heading">{data.blogs.length} blog{data.blogs.length === 1 ? '' : 's'}</h2>
		{#if data.blogs.length === 0}
			<EmptyState title="No blogs yet." />
		{:else}
			<ul class="blog-list">
				{#each data.blogs as blog (blog.id)}
					<li class="blog-row">
						<div class="blog-main">
							<a class="blog-title" href="/b/{blog.slug}">{blog.title}</a>
							{#if blog.description}<p class="blog-desc">{blog.description}</p>{/if}
						</div>
						<div class="blog-actions">
							<Button href="/admin/b/{blog.slug}/manage" variant="ghost" size="sm">Manage</Button>
							<Button href="/admin/b/{blog.slug}/posts" variant="ghost" size="sm">Posts</Button>
							<Button href="/admin/b/{blog.slug}/review" variant="ghost" size="sm">Review</Button>
							<Button href="/admin/b/{blog.slug}/settings" variant="ghost" size="sm">Settings</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.heading {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--color-text);
		margin: var(--space-1) 0 var(--space-2);
	}
	.note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-3);
		max-width: 70ch;
	}
	.warn {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-danger);
		margin: var(--space-3) 0 0;
	}
	code {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--text-xs);
		background: var(--color-surface-alt);
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
	}
	.sub-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.sub-list li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.sub {
		word-break: break-all;
	}
	.reports-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.reports-cta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.blog-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.blog-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding-bottom: var(--space-3);
		border-bottom: var(--border-1) solid var(--color-border);
	}
	.blog-row:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}
	.blog-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.blog-title {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--color-link);
		text-decoration: none;
	}
	.blog-title:hover {
		text-decoration: underline;
	}
	.blog-desc {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
		max-width: 60ch;
	}
	.blog-actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
