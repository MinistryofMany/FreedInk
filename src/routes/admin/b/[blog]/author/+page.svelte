<script lang="ts">
	import { onMount } from 'svelte';
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
	let content = '';
	let submitForReview = true;
	// Default to the blog's default language (server-injected via the load).
	let language: string = data.blog?.defaultLanguage ?? 'en';
	let busy = false;
	let error = '';
	let password = '';
	let needsPassword = false;
	// Post-submit confirmation state (replaces the old silent goto('/admin')).
	let done = false;
	let doneMessage = '';

	// A user who signs in but hasn't set up an identity gets bounced to
	// /signup/identity mid-compose. Stash the in-progress draft so it survives that
	// detour (identity setup returns here via ?next=) instead of being lost.
	const DRAFT_KEY = `freedink.draft.${data.blog.id}`;

	function stashDraft() {
		try {
			sessionStorage.setItem(
				DRAFT_KEY,
				JSON.stringify({ title, content, submitForReview, language })
			);
		} catch {
			// sessionStorage can be unavailable (private mode / quota). Draft
			// persistence is a best-effort convenience, not correctness-critical.
		}
	}

	function clearDraft() {
		try {
			sessionStorage.removeItem(DRAFT_KEY);
		} catch {
			// Best-effort; see stashDraft.
		}
	}

	onMount(() => {
		try {
			const raw = sessionStorage.getItem(DRAFT_KEY);
			if (!raw) return;
			const d = JSON.parse(raw) as Partial<{
				title: string;
				content: string;
				submitForReview: boolean;
				language: string;
			}>;
			if (typeof d.title === 'string') title = d.title;
			if (typeof d.content === 'string') content = d.content;
			if (typeof d.submitForReview === 'boolean') submitForReview = d.submitForReview;
			if (typeof d.language === 'string') language = d.language;
			clearDraft();
		} catch {
			// Corrupt/blocked storage — start with an empty composer.
		}
	});

	function writeAnother() {
		title = '';
		content = '';
		submitForReview = true;
		error = '';
		done = false;
		doneMessage = '';
	}

	async function unlock() {
		const res = await fetch('/api/identity');
		const json = await res.json();
		if (!json.identity) {
			// Preserve the draft across the identity-setup detour and come back here.
			stashDraft();
			const next = encodeURIComponent(`/admin/b/${data.blog.slug}/author`);
			window.location.href = `/signup/identity?next=${next}`;
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
			if (!identity) {
				// No identity cached in this tab. Never call unlock() with an empty
				// password (it would fail decrypt and surface a bogus "wrong
				// password"). Render the unlock form first; once a password has been
				// entered, unlock and continue.
				if (!password) {
					needsPassword = true;
					return;
				}
				identity = await unlock();
			}
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
				// Session-free write: never attach the session cookie. Authorization
				// is the Semaphore proof; the request reveals nothing the proof
				// doesn't already.
				credentials: 'omit',
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
			clearDraft();
			doneMessage = submitForReview
				? 'Submitted for review. Reviewers will vote before it publishes.'
				: 'Saved as a draft. It stays private until you submit it for review.';
			done = true;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

{#if done}
	<Card class="success-card">
		<Kicker>Done</Kicker>
		<h2 class="page-heading">{doneMessage}</h2>
		<div class="form-actions success-actions">
			<Button onclick={writeAnother}>Write another post</Button>
			<Button href="/admin/b/{data.blog.slug}/manage" variant="ghost">Back to blog</Button>
		</div>
	</Card>
{:else}
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
{/if}

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

	.title-wrapper :global(.field) {
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

	.native-select {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
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

	.success-actions {
		gap: var(--space-3);
	}
</style>
