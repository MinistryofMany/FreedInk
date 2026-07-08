<script lang="ts">
	// IMPORTANT: no static imports of `$lib/client/vault` or
	// `$lib/client/semaphore`. Anonymous readers of a post must not download
	// snarkjs / identity primitives / vault crypto just to read text. The
	// comment form is gated on `signedIn` and dynamic-imports its deps inside
	// the click handlers.
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import {
		Badge,
		Button,
		Byline,
		Dialog,
		EmptyState,
		Field,
		Kicker,
		Rule
	} from '$lib/components/ui';
	import ReaderControls from '$lib/components/reader/ReaderControls.svelte';
	import { reader, loadReader } from '$lib/reader/settings.svelte';

	export let data;

	$: signedIn = !!$page.data.user;

	// Accumulator for paginated comments. Mirrors the pattern used on other
	// listing pages: reset when commentsCursor is null (fresh load / after
	// posting a comment), append when it advances.
	let comments: typeof data.Comments = data.Comments;
	let commentsNextCursor: string | null = data.commentsNextCursor;
	let lastSeenCommentsCursor: string | null = null;
	let loadingMoreComments = false;

	$: {
		const c = $page.url.searchParams.get('commentsCursor');
		if (c === null) {
			comments = data.Comments;
			lastSeenCommentsCursor = null;
		} else if (c !== lastSeenCommentsCursor) {
			const seen = new Set(comments.map((cm) => cm.id));
			comments = [...comments, ...data.Comments.filter((cm) => !seen.has(cm.id))];
			lastSeenCommentsCursor = c;
		}
		commentsNextCursor = data.commentsNextCursor;
	}

	async function loadMoreComments() {
		if (!commentsNextCursor || loadingMoreComments) return;
		loadingMoreComments = true;
		try {
			const u = new URL($page.url);
			u.searchParams.set('commentsCursor', commentsNextCursor);
			await goto(u.pathname + u.search, {
				noScroll: true,
				keepFocus: true,
				replaceState: false
			});
		} finally {
			loadingMoreComments = false;
		}
	}

	// Trim post content to a short, plain-text OG description. We never put
	// raw HTML in og:description, so the only escaping that matters is the
	// length cap.
	$: ogDescription = (data.Post.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
	$: publishedIso = data.Post.publishedAt ? new Date(data.Post.publishedAt).toISOString() : null;

	let body = '';
	let password = '';
	let needsPassword = false;
	let busy = false;
	let error = '';

	type Identity = import('@semaphore-protocol/identity').Identity;
	let cached: Identity | null = null;

	async function loadVault() {
		const mod = await import('$lib/client/vault');
		return mod;
	}

	async function unlock() {
		const vault = await loadVault();
		cached = vault.getCachedIdentity();
		if (cached) return cached;

		const res = await fetch('/api/identity');
		if (!res.ok) throw new Error('sign in to comment');
		const json = await res.json();
		if (!json.identity) throw new Error('create an identity first');
		const blob = vault.decodeFromWire(json.identity);
		const id = await vault.unlockIdentity(blob, password);
		vault.cacheUnlockedIdentity(id);
		needsPassword = false;
		password = '';
		cached = id;
		return id;
	}

	async function unlockFromForm() {
		try {
			await unlock();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	// ──────────── Report dialog state ────────────
	// One dialog reused for both the post and any comment. The submit
	// handler reads `reportTarget` to know what target to attach. Driven by the
	// UI Dialog component via a bound `reportOpen` boolean.
	let reportOpen = false;
	let reportTarget: { type: 'post' | 'comment'; id: string; label: string } | null = null;
	let reportReason: 'spam' | 'harassment' | 'csam' | 'malware' | 'copyright' | 'other' = 'spam';
	let reportDetails = '';
	let reportBusy = false;
	let reportError = '';
	let reportOk = false;

	function openReport(target: { type: 'post' | 'comment'; id: string; label: string }) {
		reportTarget = target;
		reportReason = 'spam';
		reportDetails = '';
		reportError = '';
		reportOk = false;
		reportOpen = true;
	}

	function closeReport() {
		reportOpen = false;
		reportTarget = null;
	}

	async function submitReport() {
		if (!reportTarget) return;
		reportBusy = true;
		reportError = '';
		try {
			const res = await fetch('/api/report', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					target_type: reportTarget.type,
					target_id: reportTarget.id,
					reason: reportReason,
					details: reportDetails || undefined
				})
			});
			if (!res.ok) {
				reportError = (await res.text()) || 'report failed';
				return;
			}
			reportOk = true;
			reportDetails = '';
		} catch (e) {
			reportError = (e as Error).message;
		} finally {
			reportBusy = false;
		}
	}

	async function postComment() {
		busy = true;
		error = '';
		try {
			let identity: Identity | null = cached;
			if (!identity) {
				// Pick up an identity already unlocked elsewhere in this tab.
				const vault = await loadVault();
				identity = vault.getCachedIdentity();
				if (identity) cached = identity;
			}
			if (!identity) {
				// Nothing cached. Never decrypt with an empty password — show the
				// unlock field first. A wrong password on a real attempt keeps the
				// field visible so the user can retry; only genuinely non-password
				// errors (not signed in, no identity) propagate.
				if (!password) {
					needsPassword = true;
					return;
				}
				try {
					identity = await unlock();
				} catch (e) {
					const msg = (e as Error).message;
					if (msg === 'wrong password') {
						needsPassword = true;
						error = msg;
						return;
					}
					throw e;
				}
			}
			const sem = await import('$lib/client/semaphore');
			const group = await sem.fetchGroup(data.Blog.slug, 'comment');
			const proof = await sem.buildProof({
				identity,
				identities: group.identities,
				scope: `comment:${data.Post.versionId}`,
				message: body
			});
			const res = await fetch('/api/post/comment', {
				method: 'POST',
				// Session-free write: never attach the session cookie.
				credentials: 'omit',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ post_version_id: data.Post.versionId, body, proof })
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			body = '';
			await invalidateAll();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	onMount(loadReader);
</script>

<svelte:head>
	<title>{data.Post.title} — {data.Blog.title}</title>
	<meta name="description" content={ogDescription} />
	<meta property="og:type" content="article" />
	<meta property="og:title" content={data.Post.title} />
	<meta property="og:description" content={ogDescription} />
	{#if publishedIso}
		<meta property="article:published_time" content={publishedIso} />
	{/if}
	<meta property="og:locale" content={data.Post.language} />
	<meta property="og:site_name" content={data.Blog.title} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={data.Post.title} />
	<meta name="twitter:description" content={ogDescription} />
</svelte:head>

<article
	lang={data.Post.language}
	style="--rf:{reader.font}; --rs:{reader.size}px; --rw:{reader.width}px; --rl:{reader.line}"
>
	<header class="post-header">
		<div class="post-head-row">
			<Kicker>Essay · {data.Blog.title}</Kicker>
			<div class="reader-controls-slot">
				<ReaderControls />
			</div>
		</div>
		<h1 class="post-title">{data.Post.title}</h1>
		<Byline
			author={data.Blog.title}
			meta={[
				'anonymous',
				data.Post.publishedAt
					? new Date(data.Post.publishedAt).toLocaleDateString(undefined, {
							year: 'numeric',
							month: 'long',
							day: 'numeric'
						})
					: $_('post.status', { values: { status: data.Post.status } })
			]}
		/>
		<div class="lang-row">
			<Badge tone="neutral">{data.Post.language.toUpperCase()}</Badge>
		</div>
	</header>
	<Rule />
	<!-- bodyHtml is rendered server-side by renderMarkdown (marked + DOMPurify
	     allowlist sanitize, src/lib/server/markdown.ts), so the static-analysis
	     XSS warning does not apply here. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<div class="content">{@html data.Post.bodyHtml}</div>
	<div class="report-row">
		<Button
			variant="ghost"
			size="sm"
			onclick={() => openReport({ type: 'post', id: data.Post.id, label: data.Post.title })}
		>
			{$_('actions.report')}
		</Button>
	</div>
</article>

<section class="comments">
	<h2 class="comments-heading">{$_('comments.heading')}</h2>
	{#if comments.length === 0}
		<EmptyState title={$_('comments.empty')} />
	{:else}
		<ul class="comment-list">
			{#each comments as c (c.id)}
				<li class="comment">
					<div class="comment-top">
						<time class="comment-time">{new Date(c.createdAt).toLocaleString()}</time>
						<Button
							variant="ghost"
							size="sm"
							onclick={() =>
								openReport({
									type: 'comment',
									id: c.id,
									label: c.body.slice(0, 60)
								})}
						>
							{$_('actions.report')}
						</Button>
					</div>
					<p class="comment-body">{c.body}</p>
				</li>
			{/each}
		</ul>
		{#if commentsNextCursor}
			<form
				method="get"
				action={`/b/${data.Blog.slug}/${data.Post.slug}`}
				on:submit|preventDefault={loadMoreComments}
				class="load-more"
			>
				<input type="hidden" name="commentsCursor" value={commentsNextCursor} />
				<Button type="submit" variant="ghost" disabled={loadingMoreComments}>
					{loadingMoreComments ? $_('comments.loading') : $_('comments.load_more')}
				</Button>
			</form>
		{/if}
	{/if}

	{#if signedIn}
		<h3 class="leave-heading">{$_('comments.leave_heading')}</h3>
		{#if needsPassword}
			<form class="comment-form" on:submit|preventDefault={unlockFromForm}>
				<Field
					label={$_('comments.identity_password_label')}
					type="password"
					bind:value={password}
					required
					autocomplete="current-password"
				/>
				<div class="form-actions">
					<Button type="submit">{$_('comments.unlock_button')}</Button>
				</div>
			</form>
		{/if}
		<form class="comment-form" on:submit|preventDefault={postComment}>
			<Field
				label={$_('comments.leave_heading')}
				multiline
				bind:value={body}
				required
				placeholder={$_('comments.placeholder')}
				maxlength={4000}
				rows={4}
			/>
			<div class="form-actions">
				<Button type="submit" disabled={busy || !body}>{$_('comments.post_button')}</Button>
			</div>
		</form>
		{#if error}<p class="form-error" role="alert">{error}</p>{/if}
		<p class="hint">{$_('comments.anonymous_hint')}</p>
	{:else}
		<p class="signin-prompt">
			<a href="/signup">{$_('comments.sign_in_to_comment_prefix')}</a>
			{$_('comments.sign_in_to_comment_suffix')}
		</p>
	{/if}
</section>

<Dialog
	bind:open={reportOpen}
	title={$_('report.heading', { values: { type: reportTarget?.type ?? '' } })}
>
	<form class="report-form" on:submit|preventDefault={submitReport}>
		{#if reportTarget}
			<p class="report-target">
				{$_('report.target', { values: { label: reportTarget.label } })}
			</p>
		{/if}
		<label class="report-label">
			{$_('report.reason_label')}
			<select bind:value={reportReason} class="report-select">
				<option value="spam">{$_('report.reason.spam')}</option>
				<option value="harassment">{$_('report.reason.harassment')}</option>
				<option value="csam">{$_('report.reason.csam')}</option>
				<option value="malware">{$_('report.reason.malware')}</option>
				<option value="copyright">{$_('report.reason.copyright')}</option>
				<option value="other">{$_('report.reason.other')}</option>
			</select>
		</label>
		<Field
			label={$_('report.details_label')}
			multiline
			bind:value={reportDetails}
			placeholder={$_('report.details_placeholder')}
			maxlength={2000}
			rows={4}
		/>
		{#if reportError}<p class="report-err" role="alert">{reportError}</p>{/if}
		{#if reportOk}<p class="report-ok">{$_('report.submitted_thanks')}</p>{/if}
		<div class="dialog-btns">
			<Button variant="ghost" onclick={closeReport}>{$_('actions.close')}</Button>
			<Button type="submit" disabled={reportBusy || reportOk}>
				{reportBusy ? $_('report.sending') : $_('report.submit')}
			</Button>
		</div>
	</form>
</Dialog>

<style>
	article {
		max-width: var(--rw, var(--reading-width));
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
	}
	.post-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.post-head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.reader-controls-slot {
		flex-shrink: 0;
	}
	.post-title {
		font-family: var(--font-display);
		font-weight: 600;
		line-height: 1.15;
		color: var(--color-text);
		margin: 0;
	}
	.lang-row {
		display: flex;
	}
	.content {
		font-family: var(--rf, var(--font-reading));
		font-size: var(--rs, var(--reading-size));
		line-height: var(--rl, var(--reading-line));
		color: var(--color-text);
		margin-top: var(--space-5);
	}
	.content :global(pre) {
		white-space: pre-wrap;
		overflow-x: auto;
		background: var(--color-surface-alt);
		color: var(--color-text);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}
	.content :global(code) {
		font-family: var(--font-mono, ui-monospace, monospace);
	}
	.content :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-md);
	}
	.content :global(a) {
		color: var(--color-link);
	}
	.content :global(blockquote) {
		border-left: var(--border-2, 2px) solid var(--color-border-strong);
		padding-left: var(--space-4);
		color: var(--color-text-muted);
		margin-left: 0;
	}
	.report-row {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--space-5);
	}

	.comments {
		max-width: var(--reading-width);
		margin: var(--space-6, 2rem) auto;
		border-top: var(--border-1) solid var(--color-border);
		padding: var(--space-5) var(--space-4) 0;
	}
	.comments-heading {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--color-text);
		margin: 0 0 var(--space-4);
	}
	.comment-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.comment {
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}
	.comment-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.comment-time {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.comment-body {
		margin: var(--space-2) 0 0;
		font-family: var(--font-ui);
		font-size: var(--text-base);
		color: var(--color-text);
		white-space: pre-wrap;
	}
	.load-more {
		margin-top: var(--space-4);
		display: flex;
		justify-content: center;
	}
	.leave-heading {
		font-family: var(--font-display);
		font-size: var(--text-base);
		color: var(--color-text);
		margin: var(--space-5) 0 var(--space-3);
	}
	.comment-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	.form-actions {
		display: flex;
		justify-content: flex-end;
	}
	.form-error {
		color: var(--color-danger);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: var(--space-2) 0 0;
	}
	.hint {
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin-top: var(--space-3);
	}
	.signin-prompt {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.report-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.report-target {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.report-label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}
	.report-select {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}
	.report-err {
		color: var(--color-danger);
		font-size: var(--text-sm);
		margin: 0;
	}
	.report-ok {
		color: var(--color-accent);
		font-size: var(--text-sm);
		margin: 0;
	}
	.dialog-btns {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
</style>
