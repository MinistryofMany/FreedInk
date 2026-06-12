<script lang="ts">
	import { enhance } from '$app/forms';
	export let data;
	$: ({ blog, post, versions, comments } = data);
</script>

<svelte:head>
	<title>Moderate post — {blog.title}</title>
</svelte:head>

<header>
	<p><a href="/admin/b/{blog.slug}/manage">&larr; {blog.title}</a></p>
	<h2>Post moderation</h2>
	<p class="meta">
		Post ID: <code>{post.id}</code> &middot; status: <code>{post.status}</code>
	</p>
</header>

<section>
	<h3>Versions</h3>
	{#if versions.length === 0}
		<p>No versions for this post.</p>
	{:else}
		<ul class="versions">
			{#each versions as v}
				<li class:hidden={v.deletedAt}>
					<div class="row">
						<div>
							<strong>v{v.version}</strong>
							{#if v.id === post.currentVersionId}
								<span class="tag">current</span>
							{/if}
							<span class="tag">{v.status}</span>
							{#if v.deletedAt}
								<span class="tag warn">hidden</span>
							{/if}
						</div>
						<div class="actions">
							{#if v.deletedAt}
								<form method="POST" action="?/restore_post" use:enhance>
									<input type="hidden" name="version_id" value={v.id} />
									<button type="submit">Restore</button>
								</form>
							{:else}
								<form method="POST" action="?/hide_post" use:enhance>
									<input type="hidden" name="version_id" value={v.id} />
									<button type="submit">Hide</button>
								</form>
							{/if}
						</div>
					</div>
					<h4>{v.title}</h4>
					<pre class="body">{v.content}</pre>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h3>Comments on current version</h3>
	{#if comments.length === 0}
		<p>No comments.</p>
	{:else}
		<ul class="comments">
			{#each comments as c}
				<li class:hidden={c.deletedAt}>
					<div class="row">
						<div>
							<span class="meta">{new Date(c.createdAt).toLocaleString()}</span>
							{#if c.deletedAt}
								<span class="tag warn">hidden</span>
							{/if}
						</div>
						<div class="actions">
							{#if c.deletedAt}
								<form method="POST" action="?/restore_comment" use:enhance>
									<input type="hidden" name="comment_id" value={c.id} />
									<button type="submit">Restore</button>
								</form>
							{:else}
								<form method="POST" action="?/hide_comment" use:enhance>
									<input type="hidden" name="comment_id" value={c.id} />
									<button type="submit">Hide</button>
								</form>
							{/if}
						</div>
					</div>
					<p>{c.body}</p>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	header {
		margin-bottom: 1.5rem;
	}
	.meta {
		color: #666;
		font-size: 0.85rem;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	.tag {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		font-size: 0.75rem;
		background: #eee;
		border-radius: 0.25rem;
		margin-right: 0.25rem;
	}
	.tag.warn {
		background: #fee;
		color: #900;
	}
	.versions,
	.comments {
		list-style: none;
		padding: 0;
	}
	.versions li,
	.comments li {
		border: 1px solid #ddd;
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		border-radius: 0.25rem;
	}
	.hidden {
		opacity: 0.55;
		background: #fafafa;
	}
	.body {
		white-space: pre-wrap;
		font-family: inherit;
		font-size: 0.9rem;
	}
</style>
