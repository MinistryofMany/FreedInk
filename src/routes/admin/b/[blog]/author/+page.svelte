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

			const group = await fetchGroup(data.blog.slug);
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

<h3>New post for: {data.blog.title}</h3>

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
	<label class="lang-field">
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
		{busy ? 'Submitting…' : 'Create Post'}
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
</style>
