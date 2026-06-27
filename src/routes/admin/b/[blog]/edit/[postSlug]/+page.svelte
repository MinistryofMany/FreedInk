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
	import { Card, Field, Button, Badge, Kicker } from '$lib/components/ui';

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

			const group = await fetchGroup(data.blog.slug, 'author');
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

{#if data.feedback && (data.feedback.reasonCounts.length > 0 || data.feedback.comments.length > 0)}
	<Card class="feedback-card">
		<Kicker>Anonymous reviewer feedback</Kicker>
		<h2 class="page-heading" id="feedback-heading">Reviewer feedback</h2>
		<p class="muted" aria-describedby="feedback-heading">
			Aggregated across {data.feedback.approves + data.feedback.rejects} vote{data.feedback
				.approves +
				data.feedback.rejects ===
			1
				? ''
				: 's'} ({data.feedback.approves} approve · {data.feedback.rejects} reject). Individual reviewers
			are not named — the cryptography prevents linking votes to identities.
		</p>
		{#if data.feedback.reasonCounts.length > 0}
			<ul class="reason-list">
				{#each data.feedback.reasonCounts as r}
					<li>
						<Badge tone="warning">{r.label} · {r.count}</Badge>
					</li>
				{/each}
			</ul>
		{/if}
		{#if data.feedback.comments.length > 0}
			<details class="comments-disclosure">
				<summary>Reviewer comments ({data.feedback.comments.length})</summary>
				<ul class="comment-list">
					{#each data.feedback.comments as c}
						<li>
							<Badge tone={c.vote === 'approve' ? 'success' : 'danger'}>{c.vote}</Badge>
							<span class="comment-body">{c.comment}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</Card>
{/if}

{#if needsPassword}
	<Card class="unlock-card">
		<Kicker>Locked identity</Kicker>
		<h2 class="page-heading">Unlock your identity</h2>
		<form on:submit|preventDefault={unlockFromForm} class="unlock-form">
			<Field
				label="Identity password"
				type="password"
				bind:value={password}
				required
				autocomplete="current-password"
			/>
			<div class="form-actions">
				<Button type="submit">Unlock</Button>
			</div>
		</form>
	</Card>
{/if}

<Card>
	<Kicker>Edit post</Kicker>
	<h2 class="page-heading">{data.blog.title}</h2>
	<p class="muted version-info">
		Editing version {data.post.version} (status: {data.post.status}). Saving will create version {data
			.post.version + 1}.
	</p>

	<form on:submit|preventDefault={submit}>
		<div class="title-wrapper">
			<Field label="Post Title" id="post-title" bind:value={title} required />
			<div class="field-native">
				<label class="native-label" for="post-slug">Mock URL</label>
				<input type="text" id="post-slug" class="native-input" value={titleSlug} disabled />
			</div>
		</div>
		<div class="field-native">
			<span class="native-label">Content</span>
			<MarkdownEditor
				bind:value={content}
				placeholder="Edit your post — formatting saves as markdown."
			/>
		</div>
		<div class="preview-controls">
			<Button variant="ghost" size="sm" onclick={() => (showRawMarkdown = !showRawMarkdown)}>
				{showRawMarkdown ? 'Hide raw markdown' : 'Show raw markdown'}
			</Button>
			<small class="muted"
				>The editor above renders formatting live. This toggle reveals the serialized markdown the
				server will store.</small
			>
		</div>
		{#if showRawMarkdown}
			<pre class="raw-markdown" aria-label="Raw markdown preview">{content}</pre>
		{/if}
		<div class="field-native">
			<label class="native-label" for="post-language">Language</label>
			<select id="post-language" class="native-select" bind:value={language}>
				{#each POST_LANGUAGES as l}
					<option value={l.code}>{l.name}</option>
				{/each}
			</select>
		</div>
		<label class="checkbox-row">
			<input type="checkbox" bind:checked={submitForReview} />
			<span>Submit for review immediately (uncheck to save as draft)</span>
		</label>
		{#if error}
			<p class="error-text" role="alert">{error}</p>
		{/if}
		<div class="form-actions">
			<Button type="submit" disabled={busy} loading={busy}>
				{busy ? 'Saving…' : 'Save new version'}
			</Button>
		</div>
	</form>
</Card>

<style>
	.page-heading {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		margin: var(--space-1) 0 var(--space-2);
	}

	.muted {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.version-info {
		margin: 0 0 var(--space-5);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 80ch;
	}

	:global(.feedback-card),
	:global(.unlock-card) {
		margin-bottom: var(--space-5);
	}

	.unlock-form {
		max-width: 40ch;
	}

	.title-wrapper {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.title-wrapper :global(.field),
	.title-wrapper .field-native {
		flex: 1 1 16rem;
	}

	.field-native {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.native-label {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.native-input,
	.native-select {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
	}

	.native-input:disabled {
		color: var(--color-text-muted);
		background: var(--color-surface-alt);
	}

	.native-select {
		max-width: 32ch;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	.checkbox-row input {
		accent-color: var(--color-accent);
	}

	.error-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-danger);
	}

	.form-actions {
		display: flex;
	}

	/* Feedback */
	.reason-list {
		list-style: none;
		padding: 0;
		margin: var(--space-3) 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.comments-disclosure {
		margin-top: var(--space-3);
	}

	.comments-disclosure summary {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
		cursor: pointer;
	}

	.comment-list {
		list-style: none;
		padding: 0;
		margin: var(--space-3) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.comment-list li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding-bottom: var(--space-2);
		border-bottom: var(--border-1) solid var(--color-border);
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	/* Preview */
	.preview-controls {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		flex-wrap: wrap;
	}

	.raw-markdown {
		border: var(--border-1) solid var(--color-border);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-surface-alt);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text);
		white-space: pre-wrap;
		overflow-x: auto;
	}
</style>
