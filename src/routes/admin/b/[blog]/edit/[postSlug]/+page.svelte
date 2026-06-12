<script lang="ts">
	import { goto } from '$app/navigation';
	import { sluggify } from '$lib/utils';
	import {
		getCachedIdentity,
		cacheUnlockedIdentity,
		unlockIdentity,
		decodeFromWire
	} from '$lib/client/vault';
	import { buildProof, fetchGroup } from '$lib/client/semaphore';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { POST_LANGUAGES } from '$lib/languages';

	export let data;

	// Pre-fill from the current version. The author starts where the live post
	// left off; saving creates a new version row with version = current+1.
	let title = data.post.title;
	$: titleSlug = sluggify(title);
	let content = data.post.content;
	let language = data.post.language;
	let submitForReview = true;
	let busy = false;
	let error = '';
	let password = '';
	let needsPassword = false;

	// Wave 3B added a marked + DOMPurify-backed preview panel here. That panel
	// is now obsolete: the WYSIWYG IS the preview — Tiptap renders the
	// markdown live as the author types. We keep an opt-in "show raw markdown"
	// toggle below as a sanity check for users editing legacy posts who want
	// to confirm the serialized markdown the server will store.
	let showRawMarkdown = false;

	async function getIdentity() {
		const cached = getCachedIdentity();
		if (cached) return cached;
		needsPassword = true;
		throw new Error('password required');
	}

	async function unlock() {
		const res = await fetch('/api/identity');
		const json = await res.json();
		if (!json.identity) {
			window.location.href = '/signup/identity';
			return null;
		}
		const blob = decodeFromWire(json.identity);
		const id = await unlockIdentity(blob, password);
		cacheUnlockedIdentity(id);
		needsPassword = false;
		password = '';
		return id;
	}

	async function unlockFromForm() {
		try {
			await unlock();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function submit() {
		busy = true;
		error = '';
		try {
			// Used to be enforced by the textarea's required attribute.
			if (!content.trim()) {
				error = 'post content cannot be empty';
				return;
			}
			let identity = getCachedIdentity();
			if (!identity) identity = await unlock();
			if (!identity) return;

			const group = await fetchGroup(data.blog.slug);
			if (!group.identities.includes(identity.commitment.toString())) {
				error =
					"your active identity isn't in this blog's membership snapshot — ask an owner to refresh your role";
				return;
			}

			// Scope MUST match the server's expected scope:
			//   edit:<post_id>:<next_version_number>
			// where next_version_number = current_version + 1.
			const nextVersion = data.post.version + 1;

			const proof = await buildProof({
				identity,
				identities: group.identities,
				scope: `edit:${data.post.id}:${nextVersion}`,
				message: `${title}\n\n${content}`
			});

			const res = await fetch('/api/blog/post/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					post_version_id: data.post.versionId,
					title,
					content,
					proof,
					submit_for_review: submitForReview,
					language
				})
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			goto('/admin');
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<h3>Edit post in: {data.blog.title}</h3>
<p class="meta">
	Editing version {data.post.version} (status: {data.post.status}). Saving will create version {data
		.post.version + 1}.
</p>

{#if data.feedback && (data.feedback.reasonCounts.length > 0 || data.feedback.comments.length > 0)}
	<section class="feedback" aria-labelledby="feedback-heading">
		<h4 id="feedback-heading">Anonymous reviewer feedback</h4>
		<p class="meta">
			Aggregated across {data.feedback.approves + data.feedback.rejects} vote{data.feedback
				.approves +
				data.feedback.rejects ===
			1
				? ''
				: 's'} ({data.feedback.approves} approve · {data.feedback.rejects} reject). Individual
			reviewers are not named — the cryptography prevents linking votes to identities.
		</p>
		{#if data.feedback.reasonCounts.length > 0}
			<ul class="reason-list">
				{#each data.feedback.reasonCounts as r}
					<li><strong>{r.label}</strong> · {r.count}</li>
				{/each}
			</ul>
		{/if}
		{#if data.feedback.comments.length > 0}
			<details>
				<summary>Reviewer comments ({data.feedback.comments.length})</summary>
				<ul class="comment-list">
					{#each data.feedback.comments as c}
						<li>
							<span class="comment-vote" class:approve={c.vote === 'approve'}
								>{c.vote}</span
							>
							<span class="comment-body">{c.comment}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>
{/if}

{#if needsPassword}
	<form on:submit|preventDefault={unlockFromForm}>
		<label>
			Identity password
			<input type="password" bind:value={password} required autocomplete="current-password" />
		</label>
		<button type="submit">Unlock</button>
	</form>
{/if}

<form on:submit|preventDefault={submit}>
	<div class="title-wrapper">
		<div class="field">
			<label for="post-title">Post Title</label>
			<input type="text" id="post-title" name="title" bind:value={title} required />
		</div>
		<div class="field">
			<label for="post-slug">Mock URL</label>
			<input type="text" id="post-slug" bind:value={titleSlug} disabled />
		</div>
	</div>
	<div class="field">
		<label for="post-content">Content</label>
		<MarkdownEditor
			bind:value={content}
			placeholder="Edit your post — formatting saves as markdown."
		/>
	</div>
	<div class="preview-controls">
		<button type="button" on:click={() => (showRawMarkdown = !showRawMarkdown)}>
			{showRawMarkdown ? 'Hide raw markdown' : 'Show raw markdown'}
		</button>
		<small
			>The editor above renders formatting live. This toggle reveals the serialized markdown the
			server will store.</small
		>
	</div>
	{#if showRawMarkdown}
		<pre class="raw-markdown" aria-label="Raw markdown preview">{content}</pre>
	{/if}
	<label>
		Language
		<select bind:value={language}>
			{#each POST_LANGUAGES as l}
				<option value={l.code}>{l.name}</option>
			{/each}
		</select>
	</label>
	<label>
		<input type="checkbox" bind:checked={submitForReview} />
		Submit for review immediately (uncheck to save as draft)
	</label>
	{#if error}
		<p style="color: var(--color-red)">{error}</p>
	{/if}
	<button type="submit" disabled={busy} style="max-width: 20ch">
		{busy ? 'Saving…' : 'Save new version'}
	</button>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.title-wrapper {
		display: flex;
		gap: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	.field input {
		width: 100%;
	}
	.meta {
		color: var(--color-green-dark);
		font-size: 0.9rem;
	}
	.feedback {
		border: 1px solid var(--color-green-light);
		border-radius: 6px;
		padding: 0.75rem 1rem;
		margin: 1rem 0;
		background: var(--color-surface-alt, var(--color-green-white, transparent));
	}
	.feedback h4 {
		margin: 0 0 0.25rem;
	}
	.reason-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.reason-list li {
		padding: 0.15rem 0.5rem;
		background: color-mix(in srgb, var(--color-red) 8%, transparent);
		border-radius: 3px;
		font-size: 0.85rem;
	}
	.comment-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
	}
	.comment-list li {
		padding: 0.4rem 0;
		border-bottom: 1px dashed var(--color-border, var(--color-green-light));
		font-size: 0.9rem;
	}
	.comment-vote {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.05rem 0.35rem;
		margin-right: 0.4rem;
		background: var(--color-red);
		color: white;
		border-radius: 3px;
	}
	.comment-vote.approve {
		background: var(--color-green, #1c8a4d);
	}
	.preview-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.raw-markdown {
		border: 1px solid var(--color-green-light);
		padding: 1rem;
		border-radius: 4px;
		background: var(--color-green-lightest, #f8faf8);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.85rem;
		white-space: pre-wrap;
		overflow-x: auto;
	}
</style>
