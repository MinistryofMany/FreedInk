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
	import { Card, Field, Button, Kicker } from '$lib/components/ui';
	// Note: prover prewarm happens at the root layout for any logged-in user,
	// so this page doesn't need its own onMount hook.

	export let data;
	let title = '';
	$: titleSlug = sluggify(title);
	let content = '';
	let submitForReview = true;
	// Default to the blog's default language (server-injected via the load).
	let language: string = data.blog?.defaultLanguage ?? 'en';
	let busy = false;
	let error = '';
	let password = '';
	let needsPassword = false;

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
			// The textarea used to enforce required="" via the browser; now that
			// content comes from a custom component we validate by hand.
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

			const proof = await buildProof({
				identity,
				identities: group.identities,
				scope: `post:${data.blog.id}`,
				message: `${title}\n\n${content}`
			});

			const res = await fetch('/api/blog/post', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					blog_slug: data.blog.slug,
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
	<Kicker>New post</Kicker>
	<h2 class="page-heading">{data.blog.title}</h2>

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
			<!--
				MarkdownEditor exports markdown via bind:value so storage stays a
				markdown string (same shape the server-side renderMarkdown helper
				expects). It's the live preview AND the editor in one — we dropped
				the separate preview panel on this page since the WYSIWYG renders
				formatting inline already. The /edit page keeps its preview button
				because users editing legacy markdown sometimes want a sanity check
				against the rendered output.
			-->
			<MarkdownEditor
				bind:value={content}
				placeholder="Write your post — formatting saves as markdown."
			/>
		</div>
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
				{busy ? 'Submitting…' : 'Create Post'}
			</Button>
		</div>
	</form>
</Card>

<style>
	.page-heading {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		margin: var(--space-1) 0 var(--space-5);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 80ch;
	}

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
</style>
