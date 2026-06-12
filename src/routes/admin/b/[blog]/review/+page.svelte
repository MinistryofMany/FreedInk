<script lang="ts">
	import {
		getCachedIdentity,
		cacheUnlockedIdentity,
		unlockIdentity,
		decodeFromWire
	} from '$lib/client/vault';
	import { buildProof, fetchGroup } from '$lib/client/semaphore';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { REJECTION_REASONS } from '$lib/rejection-reasons';
	// Prover prewarm happens at the root layout for any logged-in user.

	export let data;
	let busy = false;
	let error = '';
	let password = '';
	let needsPassword = false;
	let commentByPost: Record<string, string> = {};
	// Per-post: open the reject panel + which reasons are checked. We keep
	// them keyed by version id so multiple cards on screen don't share state.
	let rejectOpenByPost: Record<string, boolean> = {};
	let reasonsByPost: Record<string, Record<string, boolean>> = {};

	function toggleReject(versionId: string) {
		rejectOpenByPost[versionId] = !rejectOpenByPost[versionId];
		rejectOpenByPost = { ...rejectOpenByPost };
		if (!reasonsByPost[versionId]) reasonsByPost[versionId] = {};
	}

	function selectedReasons(versionId: string): string[] {
		const m = reasonsByPost[versionId] ?? {};
		return Object.keys(m).filter((k) => m[k]);
	}

	// Cursor-paginated review queue. Same accumulator pattern as the public
	// listings: reset when ?cursor= goes back to null, append otherwise.
	let posts: typeof data.posts = data.posts;
	let nextCursor: string | null = data.nextCursor;
	let lastSeenCursor: string | null = null;
	let loadingMore = false;

	$: {
		const c = $page.url.searchParams.get('cursor');
		if (c === null) {
			posts = data.posts;
			lastSeenCursor = null;
		} else if (c !== lastSeenCursor) {
			const seen = new Set(posts.map((p) => p.id));
			posts = [...posts, ...data.posts.filter((p) => !seen.has(p.id))];
			lastSeenCursor = c;
		}
		nextCursor = data.nextCursor;
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const u = new URL($page.url);
			u.searchParams.set('cursor', nextCursor);
			await goto(u.pathname + u.search, {
				noScroll: true,
				keepFocus: true,
				replaceState: false
			});
		} finally {
			loadingMore = false;
		}
	}

	async function unlock() {
		const res = await fetch('/api/identity');
		const json = await res.json();
		if (!json.identity) throw new Error('no identity — create one in /signup/identity');
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

	async function vote(post_version_id: string, choice: 'approve' | 'reject') {
		busy = true;
		error = '';
		try {
			// Reject requires at least one reason — server enforces too, but
			// catch the obvious case here so we don't waste a proof.
			let reasons: string[] | undefined;
			if (choice === 'reject') {
				reasons = selectedReasons(post_version_id);
				if (reasons.length === 0) {
					error = 'pick at least one reason to reject this post';
					return;
				}
			}

			let identity = getCachedIdentity();
			if (!identity) identity = await unlock();

			const group = await fetchGroup(data.blog.slug);
			const proof = await buildProof({
				identity: identity!,
				identities: group.identities,
				scope: `review:${post_version_id}`,
				message: choice
			});
			const res = await fetch('/api/post/review', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					post_version_id,
					vote: choice,
					comment: commentByPost[post_version_id] || undefined,
					rejection_reasons: reasons,
					proof
				})
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			commentByPost[post_version_id] = '';
			reasonsByPost[post_version_id] = {};
			rejectOpenByPost[post_version_id] = false;
			await invalidateAll();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<h3>Review queue: {data.blog.title}</h3>

{#if needsPassword}
	<form on:submit|preventDefault={unlockFromForm}>
		<label>
			Identity password
			<input type="password" bind:value={password} required autocomplete="current-password" />
		</label>
		<button type="submit">Unlock</button>
	</form>
{/if}

{#if error}<p style="color: var(--color-red)">{error}</p>{/if}

{#if posts.length === 0}
	<p>Nothing under review right now.</p>
{:else}
	{#each posts as p (p.version.id)}
		<article>
			<h4>{p.version.title}</h4>
			<p class="meta">
				Submitted {new Date(p.version.submittedAt ?? p.createdAt).toLocaleString()} · approves {p
					.tally.approves} · rejects {p.tally.rejects}
			</p>
			<pre>{p.version.content}</pre>
			<label>
				Comment (optional, public)
				<textarea bind:value={commentByPost[p.version.id]} rows="2"></textarea>
			</label>
			{#if rejectOpenByPost[p.version.id]}
				<fieldset class="reasons">
					<legend>Why are you rejecting this post?</legend>
					<p class="reason-hint">
						Pick everything that applies. Reasons are aggregated and shown to the author — no
						individual reviewer is named.
					</p>
					<div class="reason-grid">
						{#each REJECTION_REASONS as r}
							<label class="reason-row">
								<input type="checkbox" bind:checked={reasonsByPost[p.version.id][r.key]} />
								<span class="reason-label">{r.label}</span>
								<span class="reason-desc">{r.description}</span>
							</label>
						{/each}
					</div>
				</fieldset>
			{/if}
			<div class="actions">
				<button on:click={() => vote(p.version.id, 'approve')} disabled={busy}>Approve</button>
				{#if rejectOpenByPost[p.version.id]}
					<button class="reject" on:click={() => vote(p.version.id, 'reject')} disabled={busy}>
						Confirm reject
					</button>
					<button type="button" class="ghost" on:click={() => toggleReject(p.version.id)}>
						Cancel
					</button>
				{:else}
					<button
						type="button"
						class="reject"
						on:click={() => toggleReject(p.version.id)}
						disabled={busy}
					>
						Reject…
					</button>
				{/if}
			</div>
		</article>
	{/each}
	{#if nextCursor}
		<form
			method="get"
			action={`/admin/b/${data.blog.slug}/review`}
			on:submit|preventDefault={loadMore}
			class="load-more"
		>
			<input type="hidden" name="cursor" value={nextCursor} />
			<button type="submit" disabled={loadingMore}>
				{loadingMore ? 'Loading…' : 'Load more'}
			</button>
		</form>
	{/if}
{/if}

<style>
	article {
		border: 1px solid var(--color-green-light);
		border-radius: 0.5rem;
		padding: 1rem;
		margin: 1rem 0;
		background: var(--color-green-white);
	}
	pre {
		white-space: pre-wrap;
		font-family: var(--text-font);
	}
	.meta {
		color: var(--color-green-dark);
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.reject {
		background: var(--color-red) !important;
		color: white !important;
	}
	.ghost {
		background: transparent !important;
		color: var(--color-text, inherit) !important;
		border: 1px solid var(--color-border, var(--color-green-light));
	}
	.reasons {
		border: 1px solid var(--color-red);
		border-radius: 4px;
		padding: 0.75rem 1rem;
		margin: 0.75rem 0;
		background: color-mix(in srgb, var(--color-red) 6%, transparent);
	}
	.reasons legend {
		font-weight: 600;
		padding: 0 0.25rem;
	}
	.reason-hint {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
		color: var(--color-green-dark);
	}
	.reason-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	@media (min-width: 600px) {
		.reason-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	.reason-row {
		display: grid;
		grid-template-columns: max-content max-content 1fr;
		align-items: baseline;
		gap: 0.4rem;
	}
	.reason-label {
		font-weight: 600;
	}
	.reason-desc {
		font-size: 0.85rem;
		color: var(--color-green-dark);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	textarea {
		width: 100%;
	}
	.load-more {
		margin-top: 1rem;
		text-align: center;
	}
</style>
