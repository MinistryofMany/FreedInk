<script lang="ts">
	import { requestAndBuildToken, castVote } from '$lib/client/vote-token';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { REJECTION_REASONS } from '$lib/rejection-reasons';
	import { Card, Field, Button, Badge, Kicker, EmptyState } from '$lib/components/ui';
	// Prover prewarm happens at the root layout for any logged-in user.

	import type { RedeemableToken } from '$lib/client/vote-token';

	export let data;
	let busy = false;
	let error = '';
	// Built blind-token per version (cached so a vote-flip reuses the same token —
	// the server UPSERTs on the token nonce). Never sent anywhere but the vote
	// redemption; holds no identity.
	let tokensByVersion: Record<string, RedeemableToken> = {};
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

	async function vote(post_version_id: string, choice: 'approve' | 'reject') {
		busy = true;
		error = '';
		try {
			// Reject requires at least one reason — server enforces too, but catch
			// the obvious case here before spending a token.
			let reasons: string[] | undefined;
			if (choice === 'reject') {
				reasons = selectedReasons(post_version_id);
				if (reasons.length === 0) {
					error = 'pick at least one reason to reject this post';
					return;
				}
			}

			// Blind-token vote: (1) authenticated issuance builds an unlinkable
			// token for this version; (2) anonymous, session-free redemption casts
			// the vote. Re-voting fetches a fresh token only on the first cast — to
			// flip a vote the server UPSERTs on the token nonce, so we reuse the same
			// token. We keep the built token per version so a flip reuses it.
			let token = tokensByVersion[post_version_id];
			if (!token) {
				token = await requestAndBuildToken(post_version_id);
				tokensByVersion[post_version_id] = token;
			}

			const res = await castVote({
				versionId: post_version_id,
				token,
				vote: choice,
				comment: commentByPost[post_version_id] || undefined,
				rejectionReasons: reasons
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
			// Surface a NON-EMPTY message no matter what. Some failures (notably the
			// old Chromium WebCrypto OperationError in token finalize) carry an empty
			// .message; falling closed-and-silent there hid a real bug. Fall back to
			// the error name, then a generic line, so the user always sees something.
			const err = e as Error;
			error =
				err?.message?.trim() ||
				err?.name ||
				'Could not cast your vote. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Review queue — {data.blog.title}</title>
</svelte:head>

<div class="page-wrap">
	<header class="page-head">
		<Kicker>Review queue</Kicker>
		<h1 class="page-heading">{data.blog.title}</h1>
	</header>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if posts.length === 0}
		<EmptyState title="Nothing under review right now." />
	{:else}
		<div class="queue">
			{#each posts as p (p.version.id)}
				<Card padding="lg" class="post-card">
					<div class="stack">
						<div class="post-head">
							<h2 class="post-title">{p.version.title}</h2>
							<p class="meta">
								Submitted {new Date(p.version.submittedAt ?? p.createdAt).toLocaleString()}
							</p>
							<div class="tally">
								<Badge tone="success">approves {p.tally.approves}</Badge>
								<Badge tone="danger">rejects {p.tally.rejects}</Badge>
							</div>
						</div>

						<pre class="body">{p.version.content}</pre>

						<Field
							label="Comment (optional, public)"
							multiline
							rows={2}
							bind:value={commentByPost[p.version.id]}
						/>

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
							<Button onclick={() => vote(p.version.id, 'approve')} disabled={busy}>Approve</Button>
							{#if rejectOpenByPost[p.version.id]}
								<Button
									variant="danger"
									onclick={() => vote(p.version.id, 'reject')}
									disabled={busy}
								>
									Confirm reject
								</Button>
								<Button variant="ghost" onclick={() => toggleReject(p.version.id)}>Cancel</Button>
							{:else}
								<Button variant="ghost" onclick={() => toggleReject(p.version.id)} disabled={busy}>
									Reject…
								</Button>
							{/if}
						</div>
					</div>
				</Card>
			{/each}
		</div>

		{#if nextCursor}
			<form
				method="get"
				action={`/admin/b/${data.blog.slug}/review`}
				on:submit|preventDefault={loadMore}
				class="load-more"
			>
				<input type="hidden" name="cursor" value={nextCursor} />
				<Button type="submit" variant="ghost" disabled={loadingMore}>
					{loadingMore ? 'Loading…' : 'Load more'}
				</Button>
			</form>
		{/if}
	{/if}
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

	.page-heading {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
		line-height: 1.2;
	}

	.error {
		color: var(--color-danger);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0 0 var(--space-4);
	}

	.queue {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.post-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.post-title {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
		line-height: 1.25;
	}

	.meta {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.tally {
		display: flex;
		gap: var(--space-2);
	}

	.body {
		white-space: pre-wrap;
		font-family: var(--font-standfirst);
		font-size: var(--text-base);
		color: var(--color-text);
		background: var(--color-surface-alt);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.reasons {
		border: var(--border-1) solid var(--color-danger);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		margin: 0;
	}

	.reasons legend {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
		padding: 0 var(--space-1);
	}

	.reason-hint {
		margin: 0 0 var(--space-3);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.reason-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
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
		gap: var(--space-2);
		font-family: var(--font-ui);
	}

	.reason-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.reason-desc {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.load-more {
		margin-top: var(--space-5);
		text-align: center;
	}
</style>
