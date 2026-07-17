<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import {
		isPushSupported,
		getSubscriptionStatus,
		subscribe as pushSubscribe,
		unsubscribe as pushUnsubscribe,
		type PushStatus
	} from '$lib/client/push';
	import { _ } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { applyTheme as applyThemeDom } from '$lib/theme';
	import {
		Card,
		Field,
		Button,
		Kicker,
		SegmentedControl,
		AlertDialog,
		Tag
	} from '$lib/components/ui';

	export let data;
	let busy = false;
	let msg = '';

	// Profile (display name) editing. Seeded from the loaded user; the
	// auto-generated `minister-…` / `0x…` username is the fallback when blank.
	let displayName = data.user.displayName ?? '';
	let profileBusy = false;
	let profileMsg = '';

	async function saveProfile() {
		const t = get(_);
		const trimmed = displayName.trim();
		if (trimmed.length > 80) {
			profileMsg = t('settings.display_name_too_long');
			return;
		}
		profileBusy = true;
		profileMsg = '';
		try {
			const res = await fetch('/api/user', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				// Empty string clears the display name (null) so the username
				// fallback takes over again.
				body: JSON.stringify({ displayName: trimmed === '' ? null : trimmed })
			});
			if (!res.ok) {
				profileMsg = await res.text();
				return;
			}
			const json = await res.json();
			displayName = json.user.displayName ?? '';
			data.user.displayName = json.user.displayName ?? null;
			profileMsg = t('settings.display_name_saved');
		} catch (e) {
			profileMsg = (e as Error).message;
		} finally {
			profileBusy = false;
		}
	}

	// Push notifications state. Stays in 'unsupported' on SSR so the button
	// label is stable until onMount can probe the actual browser support.
	let pushStatus: PushStatus = 'unsupported';
	let pushBusy = false;
	let pushMsg = '';

	onMount(async () => {
		if (!isPushSupported()) {
			pushStatus = 'unsupported';
			return;
		}
		try {
			pushStatus = await getSubscriptionStatus();
		} catch (e) {
			pushMsg = (e as Error).message;
		}
	});

	async function togglePush() {
		pushBusy = true;
		pushMsg = '';
		try {
			if (pushStatus === 'subscribed') {
				await pushUnsubscribe();
				pushStatus = 'unsubscribed';
				pushMsg = 'Push notifications disabled.';
			} else {
				await pushSubscribe();
				pushStatus = 'subscribed';
				pushMsg = 'Push notifications enabled.';
			}
		} catch (e) {
			pushMsg = (e as Error).message;
			// Re-sync in case the browser flipped state under us (denied, etc).
			try {
				pushStatus = await getSubscriptionStatus();
			} catch {
				// keep prior status
			}
		} finally {
			pushBusy = false;
		}
	}

	// Theme override — null = follow OS, 'light' / 'dark' = pinned. Persisted
	// via the freedink_theme cookie so SSR can render with the right palette
	// on the next request (no FOUC, even on hard reload). The cookie is set
	// client-side so we don't need a dedicated form action.
	type ThemePref = 'system' | 'light' | 'dark';
	const layoutTheme = ($page.data as { theme?: 'light' | 'dark' | null }).theme ?? null;
	let themePref: ThemePref =
		layoutTheme === 'light' ? 'light' : layoutTheme === 'dark' ? 'dark' : 'system';

	function applyTheme(pref: ThemePref) {
		themePref = pref;
		applyThemeDom(pref);
	}

	// Bridge the SegmentedControl's bound value to the existing applyTheme().
	// `themeSel` is the control's bound value (a plain string, its value type)
	// constrained at runtime to the three options. When the control changes it,
	// the reactive guard below fires applyTheme — but only while the two differ.
	// applyTheme writes `themePref = themeSel`, so after one run they match again
	// and the statement never re-fires: no loop.
	let themeSel: string = themePref;
	$: if (themeSel !== themePref) applyTheme(themeSel as ThemePref);

	let sessions = data.sessions;

	// Data rights state — export & delete-account flows.
	let deleteOpen = false;
	let deleteConfirm = '';
	let dataMsg = '';
	let dataBusy = false;

	async function downloadExport() {
		dataBusy = true;
		dataMsg = '';
		try {
			const res = await fetch('/api/gdpr/export', { method: 'POST' });
			if (!res.ok) {
				dataMsg = await res.text();
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `freedink-export-${data.user.id}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			dataMsg = get(_)('settings.export_downloaded');
		} catch (e) {
			dataMsg = (e as Error).message;
		} finally {
			dataBusy = false;
		}
	}

	async function deleteAccount() {
		if (deleteConfirm !== data.user.username) {
			dataMsg = get(_)('settings.error_confirm_username');
			return;
		}
		dataBusy = true;
		dataMsg = '';
		try {
			const res = await fetch('/api/gdpr/delete', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirm: deleteConfirm })
			});
			if (!res.ok) {
				dataMsg = await res.text();
				return;
			}
			window.location.href = '/';
		} catch (e) {
			dataMsg = (e as Error).message;
		} finally {
			dataBusy = false;
		}
	}

	async function revokeSession(id: string) {
		const t = get(_);
		if (!confirm(t('settings.revoke_confirm'))) return;
		busy = true;
		msg = '';
		try {
			const res = await fetch(`/api/auth/sessions?id=${encodeURIComponent(id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				msg = await res.text();
				return;
			}
			sessions = sessions.filter((s) => s.id !== id);
			msg = t('settings.session_revoked');
		} catch (e) {
			msg = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	const themeOptions = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
</script>

<svelte:head>
	<title>Settings — FreedInk</title>
</svelte:head>

<div class="page-wrap">
	<h1 class="page-heading">{$_('settings.heading')}</h1>

	<div class="sections">
		<!-- Account -->
		<Card padding="lg">
			<div class="stack">
				<Kicker>{$_('settings.account_heading')}</Kicker>
				<dl class="kv">
					<dt>{$_('settings.username_label')}</dt>
					<dd>{data.user.username}</dd>
					<dt>{$_('settings.email_label')}</dt>
					<dd>{data.user.email ?? '—'}</dd>
				</dl>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						saveProfile();
					}}
					class="row-form"
				>
					<Field
						label={$_('settings.display_name_label')}
						bind:value={displayName}
						placeholder={$_('settings.display_name_placeholder')}
						help={$_('settings.display_name_hint')}
						maxlength={80}
						autocomplete="nickname"
						class="grow"
					/>
					<Button type="submit" disabled={profileBusy}>
						{profileBusy ? $_('settings.saving') : $_('settings.save_button')}
					</Button>
				</form>
				{#if profileMsg}<p class="status">{profileMsg}</p>{/if}
			</div>
		</Card>

		<!-- Sessions -->
		<Card padding="lg">
			<div class="stack">
				<Kicker>{$_('settings.sessions_heading')}</Kicker>
				{#if sessions.length === 0}
					<p class="muted">{$_('settings.no_sessions')}</p>
				{:else}
					<ul class="sessions">
						{#each sessions as s}
							<li>
								<div class="meta">
									<div class="meta-head">
										<code title={s.userAgent ?? ''}
											>{(s.userAgent ?? $_('settings.unknown_agent')).slice(0, 80)}</code
										>
										{#if s.current}<Tag variant="solid">{$_('settings.this_device')}</Tag>{/if}
									</div>
									<small class="muted">
										{$_('settings.session_meta', {
											values: {
												ip: s.ip ?? '—',
												lastSeen: new Date(s.lastSeenAt).toLocaleString(),
												started: new Date(s.createdAt).toLocaleDateString()
											}
										})}
									</small>
								</div>
								{#if !s.current}
									<Button
										variant="ghost"
										size="sm"
										disabled={busy}
										onclick={() => revokeSession(s.id)}
									>
										{$_('settings.revoke_button')}
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</Card>

		<!-- Notifications -->
		<Card padding="lg">
			<div class="stack">
				<Kicker>Notifications</Kicker>
				<p class="muted">
					Get a desktop / mobile notification when a post needs review on a blog you moderate, or
					when a new post is published on a blog you belong to. The permission is per-browser;
					enable on each device separately.
				</p>
				{#if pushStatus === 'unsupported'}
					<div><Button variant="ghost" disabled>Push not supported in this browser</Button></div>
				{:else if pushStatus === 'denied'}
					<div>
						<Button variant="ghost" disabled
							>Notifications blocked — re-enable in browser settings</Button
						>
					</div>
				{:else if pushStatus === 'subscribed'}
					<div>
						<Button variant="ghost" disabled={pushBusy} onclick={togglePush}>
							Disable push notifications
						</Button>
					</div>
				{:else}
					<div>
						<Button disabled={pushBusy} onclick={togglePush}>Enable push notifications</Button>
					</div>
				{/if}
				{#if pushMsg}<p class="status">{pushMsg}</p>{/if}
			</div>
		</Card>

		<!-- Appearance -->
		<Card padding="lg">
			<div class="stack">
				<Kicker>Appearance</Kicker>
				<p class="muted">
					Choose a theme. "System" follows your operating system's light/dark setting; the other two
					pin the site to that palette across devices that share this browser.
				</p>
				<SegmentedControl ariaLabel="Theme" options={themeOptions} bind:value={themeSel} />
			</div>
		</Card>

		<!-- Data rights -->
		<Card padding="lg">
			<div class="stack">
				<Kicker>{$_('settings.data_rights_heading')}</Kicker>
				<p class="muted">
					{$_('settings.data_rights_blurb_prefix')}
					<a href="/legal/data-rights">{$_('settings.data_rights_link')}</a>
					{$_('settings.data_rights_blurb_suffix')}
				</p>
				<div class="dr-actions">
					<Button disabled={dataBusy} onclick={downloadExport}>
						{$_('settings.download_data')}
					</Button>
					<AlertDialog
						bind:open={deleteOpen}
						title={$_('settings.confirm_deletion_heading')}
						description={$_('settings.deletion_explanation')}
						confirmLabel={$_('settings.deletion_button')}
						cancelLabel={$_('settings.cancel')}
						tone="danger"
						confirmDisabled={deleteConfirm !== data.user.username}
						onConfirm={deleteAccount}
					>
						{#snippet trigger(props)}
							<Button
								variant="danger"
								disabled={dataBusy}
								{...props}
								onclick={() => {
									deleteConfirm = '';
									dataMsg = '';
								}}
							>
								{$_('settings.delete_account')}
							</Button>
						{/snippet}
						<div class="del-confirm stack">
							<p class="muted">
								{$_('settings.deletion_confirm_prompt_prefix')}
								<code>{data.user.username}</code>
								{$_('settings.deletion_confirm_prompt_suffix')}
							</p>
							<Field
								label={$_('settings.deletion_aria_label')}
								bind:value={deleteConfirm}
								placeholder={data.user.username}
								autocomplete="off"
							/>
						</div>
					</AlertDialog>
				</div>
				{#if dataMsg}<p class="status">{dataMsg}</p>{/if}
			</div>
		</Card>
	</div>

	{#if msg}<p class="status">{msg}</p>{/if}
</div>

<style>
	.page-wrap {
		max-width: 44rem;
		margin: var(--space-8) auto;
		padding: 0 var(--space-4);
	}

	.page-heading {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0 0 var(--space-6);
		line-height: 1.2;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.kv {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
	}

	.kv dt {
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.kv dd {
		margin: 0;
		color: var(--color-text);
	}

	.row-form {
		display: flex;
		gap: var(--space-3);
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.row-form :global(.grow) {
		flex: 1;
		min-width: 14rem;
	}

	.sessions {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.sessions li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) 0;
		border-bottom: var(--border-1) solid var(--color-border);
		align-items: center;
	}

	.sessions li:last-child {
		border-bottom: none;
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.meta-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.dr-actions {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		align-items: center;
	}

	.del-confirm {
		border-left: var(--border-2) solid var(--color-danger);
		padding-left: var(--space-4);
	}

	.muted {
		color: var(--color-text-muted);
		max-width: 60ch;
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		margin: 0;
	}

	/* Inline links inside running prose must be distinguishable without relying
	   on colour alone (WCAG 1.4.1 / axe link-in-text-block). Underline them;
	   nav/button links elsewhere intentionally stay underline-free. */
	.muted :global(a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.status {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		margin: 0;
	}

	code {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-sm);
	}
</style>
