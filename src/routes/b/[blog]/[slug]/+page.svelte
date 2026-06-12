<script lang="ts">
	// IMPORTANT: no static imports of `$lib/client/vault` or
	// `$lib/client/semaphore`. Anonymous readers of a post must not download
	// snarkjs / identity primitives / vault crypto just to read text. The
	// comment form is gated on `signedIn` and dynamic-imports its deps inside
	// the click handlers.
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';

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
	$: publishedIso = data.Post.publishedAt
		? new Date(data.Post.publishedAt).toISOString()
		: null;

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
	// handler reads `reportTarget` to know what target to attach. Uses a
	// native <dialog> element so we don't need a dialog library.
	let reportDialog: HTMLDialogElement | null = null;
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
		reportDialog?.showModal();
	}

	function closeReport() {
		reportDialog?.close();
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
				try {
					identity = await unlock();
				} catch (e) {
					if ((e as Error).message === 'wrong password') throw e;
					needsPassword = true;
					return;
				}
			}
			const sem = await import('$lib/client/semaphore');
			const group = await sem.fetchGroup(data.Blog.slug);
			const proof = await sem.buildProof({
				identity,
				identities: group.identities,
				scope: `comment:${data.Post.versionId}`,
				message: body
			});
			const res = await fetch('/api/post/comment', {
				method: 'POST',
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

<article lang={data.Post.language}>
	<h1>{data.Blog.title}</h1>
	<h2>{data.Post.title}</h2>
	<p class="meta">
		{#if data.Post.publishedAt}
			{$_('post.published_at', { values: { date: new Date(data.Post.publishedAt).toLocaleString() } })}
		{:else}
			{$_('post.status', { values: { status: data.Post.status } })}
		{/if}
		<span class="lang-badge" title={data.Post.language}>
			{data.Post.language.toUpperCase()}
		</span>
	</p>
	<div class="content">{@html data.Post.bodyHtml}</div>
	<p class="report-row">
		<button
			type="button"
			class="report-link"
			on:click={() => openReport({ type: 'post', id: data.Post.id, label: data.Post.title })}
		>
			{$_('actions.report')}
		</button>
	</p>
</article>

<section class="comments">
	<h3>{$_('comments.heading')}</h3>
	{#if comments.length === 0}
		<p>{$_('comments.empty')}</p>
	{:else}
		<ul>
			{#each comments as c (c.id)}
				<li>
					<small
						>{new Date(c.createdAt).toLocaleString()}
						<button
							type="button"
							class="report-link inline"
							on:click={() =>
								openReport({
									type: 'comment',
									id: c.id,
									label: c.body.slice(0, 60)
								})}
						>
							{$_('actions.report')}
						</button></small
					>
					<p>{c.body}</p>
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
				<button type="submit" disabled={loadingMoreComments}>
					{loadingMoreComments ? $_('comments.loading') : $_('comments.load_more')}
				</button>
			</form>
		{/if}
	{/if}

	{#if signedIn}
		<h4>{$_('comments.leave_heading')}</h4>
		{#if needsPassword}
			<form on:submit|preventDefault={unlockFromForm}>
				<label>
					{$_('comments.identity_password_label')}
					<input type="password" bind:value={password} required autocomplete="current-password" />
				</label>
				<button type="submit">{$_('comments.unlock_button')}</button>
			</form>
		{/if}
		<form on:submit|preventDefault={postComment}>
			<textarea
				bind:value={body}
				rows="3"
				required
				maxlength="4000"
				placeholder={$_('comments.placeholder')}
			></textarea>
			<button type="submit" disabled={busy || !body}>{$_('comments.post_button')}</button>
		</form>
		{#if error}<p style="color: var(--color-red)">{error}</p>{/if}
		<p class="hint">{$_('comments.anonymous_hint')}</p>
	{:else}
		<p>
			<a href="/signup">{$_('comments.sign_in_to_comment_prefix')}</a>
			{$_('comments.sign_in_to_comment_suffix')}
		</p>
	{/if}
</section>

<!-- Native <dialog> for the report modal. No deps; closeable via Esc. -->
<dialog bind:this={reportDialog} class="report-dialog">
	<form on:submit|preventDefault={submitReport}>
		<h3>{$_('report.heading', { values: { type: reportTarget?.type ?? '' } })}</h3>
		{#if reportTarget}
			<p class="dim">
				<small>{$_('report.target', { values: { label: reportTarget.label } })}</small>
			</p>
		{/if}
		<label>
			{$_('report.reason_label')}
			<select bind:value={reportReason}>
				<option value="spam">{$_('report.reason.spam')}</option>
				<option value="harassment">{$_('report.reason.harassment')}</option>
				<option value="csam">{$_('report.reason.csam')}</option>
				<option value="malware">{$_('report.reason.malware')}</option>
				<option value="copyright">{$_('report.reason.copyright')}</option>
				<option value="other">{$_('report.reason.other')}</option>
			</select>
		</label>
		<label>
			{$_('report.details_label')}
			<textarea
				bind:value={reportDetails}
				rows="3"
				maxlength="2000"
				placeholder={$_('report.details_placeholder')}
			></textarea>
		</label>
		{#if reportError}<p class="err">{reportError}</p>{/if}
		{#if reportOk}<p class="ok">{$_('report.submitted_thanks')}</p>{/if}
		<div class="dialog-btns">
			<button type="button" on:click={closeReport}>{$_('actions.close')}</button>
			<button type="submit" disabled={reportBusy || reportOk}>
				{reportBusy ? $_('report.sending') : $_('report.submit')}
			</button>
		</div>
	</form>
</dialog>

<style>
	article {
		max-width: 70ch;
		margin: 0 auto;
	}
	.content :global(pre) {
		white-space: pre-wrap;
		overflow-x: auto;
	}
	.content :global(img) {
		max-width: 100%;
		height: auto;
	}
	.meta {
		color: var(--color-green-dark);
		font-size: 0.85rem;
	}
	.lang-badge {
		display: inline-block;
		margin-left: 0.5rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		border-radius: 3px;
		background: var(--color-green-lightest, #d6f0e7);
		color: var(--color-green-dark, #134e2f);
	}
	.comments {
		max-width: 70ch;
		margin: 2rem auto;
		border-top: 1px solid var(--color-green-light);
		padding-top: 1rem;
	}
	.comments li {
		border-left: 3px solid var(--color-green-light);
		padding-left: 0.75rem;
		margin: 0.75rem 0;
	}
	textarea {
		width: 100%;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.hint {
		color: var(--color-green-dark);
		font-size: 0.85rem;
	}
	.load-more {
		margin-top: 1rem;
		text-align: center;
	}
	.report-row {
		text-align: right;
		margin-top: 1rem;
	}
	.report-link {
		background: none;
		border: none;
		color: var(--color-green-dark);
		font-size: 0.85rem;
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}
	.report-link.inline {
		margin-left: 0.5rem;
		font-size: 0.75rem;
	}
	.report-dialog {
		border: 1px solid #ccc;
		border-radius: 0.5rem;
		padding: 1rem 1.25rem;
		min-width: min(28rem, 90vw);
	}
	.report-dialog form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.report-dialog .dim {
		color: #777;
		font-size: 0.85rem;
		margin: 0;
	}
	.report-dialog .err {
		color: #b00;
	}
	.report-dialog .ok {
		color: #060;
	}
	.dialog-btns {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
</style>
