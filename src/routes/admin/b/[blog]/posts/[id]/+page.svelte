<script lang="ts">
	import { enhance } from '$app/forms';
	import { Card, Button, Badge, Tag, AlertDialog, Kicker } from '$lib/components/ui';
	export let data;
	$: ({ blog, post, versions, comments } = data);

	// AlertDialog confirms by invoking a JS callback, but the destructive work
	// must go through the existing SvelteKit form action (audit + enhance). We
	// keep the real form with its hidden inputs and submit it from onConfirm.
	function submitForm(form: HTMLFormElement | undefined) {
		form?.requestSubmit();
	}
</script>

<svelte:head>
	<title>Moderate post — {blog.title}</title>
</svelte:head>

<div class="page-wrap">
	<header class="page-head">
		<p class="back"><a href="/admin/b/{blog.slug}/manage">&larr; {blog.title}</a></p>
		<Kicker>Post moderation</Kicker>
		<h1 class="page-heading">Moderate post</h1>
		<p class="meta">
			Post ID: <code>{post.id}</code> &middot; status: <code>{post.status}</code>
		</p>
	</header>

	<section class="section">
		<h2 class="section-heading">Versions</h2>
		{#if versions.length === 0}
			<p class="muted">No versions for this post.</p>
		{:else}
			<div class="list">
				{#each versions as v}
					<Card padding="md" class={v.deletedAt ? 'item is-hidden' : 'item'}>
						<div class="row">
							<div class="tags">
								<strong class="vnum">v{v.version}</strong>
								{#if v.id === post.currentVersionId}
									<Tag variant="solid">current</Tag>
								{/if}
								<Badge>{v.status}</Badge>
								{#if v.deletedAt}
									<Badge tone="danger">hidden</Badge>
								{/if}
							</div>
							<div class="actions">
								{#if v.deletedAt}
									<form method="POST" action="?/restore_post" use:enhance>
										<input type="hidden" name="version_id" value={v.id} />
										<Button type="submit" variant="ghost" size="sm">Restore</Button>
									</form>
								{:else}
									{@const formRef = { el: undefined as HTMLFormElement | undefined }}
									<form method="POST" action="?/hide_post" use:enhance bind:this={formRef.el}>
										<input type="hidden" name="version_id" value={v.id} />
									</form>
									<AlertDialog
										title="Hide this version?"
										description="This version will be hidden from readers. You can restore it later."
										confirmLabel="Hide"
										tone="danger"
										onConfirm={() => submitForm(formRef.el)}
									>
										{#snippet trigger(props)}
											<Button variant="danger" size="sm" {...props}>Hide</Button>
										{/snippet}
									</AlertDialog>
								{/if}
							</div>
						</div>
						<h3 class="item-title">{v.title}</h3>
						<pre class="body">{v.content}</pre>
					</Card>
				{/each}
			</div>
		{/if}
	</section>

	<section class="section">
		<h2 class="section-heading">Comments on current version</h2>
		{#if comments.length === 0}
			<p class="muted">No comments.</p>
		{:else}
			<div class="list">
				{#each comments as c}
					<Card padding="md" class={c.deletedAt ? 'item is-hidden' : 'item'}>
						<div class="row">
							<div class="tags">
								<span class="meta">{new Date(c.createdAt).toLocaleString()}</span>
								{#if c.deletedAt}
									<Badge tone="danger">hidden</Badge>
								{/if}
							</div>
							<div class="actions">
								{#if c.deletedAt}
									<form method="POST" action="?/restore_comment" use:enhance>
										<input type="hidden" name="comment_id" value={c.id} />
										<Button type="submit" variant="ghost" size="sm">Restore</Button>
									</form>
								{:else}
									{@const formRef = { el: undefined as HTMLFormElement | undefined }}
									<form method="POST" action="?/hide_comment" use:enhance bind:this={formRef.el}>
										<input type="hidden" name="comment_id" value={c.id} />
									</form>
									<AlertDialog
										title="Hide this comment?"
										description="This comment will be hidden from readers. You can restore it later."
										confirmLabel="Hide"
										tone="danger"
										onConfirm={() => submitForm(formRef.el)}
									>
										{#snippet trigger(props)}
											<Button variant="danger" size="sm" {...props}>Hide</Button>
										{/snippet}
									</AlertDialog>
								{/if}
							</div>
						</div>
						<p class="comment-body">{c.body}</p>
					</Card>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.page-wrap {
		max-width: 48rem;
		margin: var(--space-8) auto;
		padding: 0 var(--space-4);
	}

	.page-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-6);
	}

	.back {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0 0 var(--space-2);
	}

	.page-heading {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
		line-height: 1.2;
	}

	.meta {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.section {
		margin-bottom: var(--space-6);
	}

	.section-heading {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0 0 var(--space-4);
		line-height: 1.25;
	}

	.muted {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.list :global(.item.is-hidden) {
		opacity: 0.6;
		background: var(--color-surface-alt);
	}

	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		margin-bottom: var(--space-3);
	}

	.tags {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.vnum {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
	}

	.item-title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--color-text);
		margin: 0 0 var(--space-2);
		line-height: 1.25;
	}

	.body {
		white-space: pre-wrap;
		font-family: var(--font-standfirst);
		font-size: var(--text-base);
		color: var(--color-text);
		margin: 0;
	}

	.comment-body {
		font-family: var(--font-standfirst);
		font-size: var(--text-base);
		color: var(--color-text);
		margin: 0;
	}
</style>
