<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import {
		generateIdentity,
		encodeForWire,
		cacheUnlockedIdentity,
		clearCachedIdentity
	} from '$lib/client/vault';
	import {
		isPushSupported,
		getSubscriptionStatus,
		subscribe as pushSubscribe,
		unsubscribe as pushUnsubscribe,
		type PushStatus
	} from '$lib/client/push';
	import { _ } from '$lib/i18n';
	import { get } from 'svelte/store';

	export let data;
	let busy = false;
	let msg = '';

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
		const html = document.documentElement;
		if (pref === 'system') {
			html.removeAttribute('data-theme');
			// Expire cookie immediately
			document.cookie = 'freedink_theme=; Path=/; Max-Age=0; SameSite=Lax';
		} else {
			html.setAttribute('data-theme', pref);
			// 1 year, SameSite=Lax — purely cosmetic, no secrets here
			document.cookie = `freedink_theme=${pref}; Path=/; Max-Age=31536000; SameSite=Lax`;
		}
	}
	let rotatePassword = '';
	let rotateConfirm = '';
	let identities = data.identities;
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

	async function rotateIdentity() {
		const t = get(_);
		if (rotatePassword.length < 12 || rotatePassword !== rotateConfirm) {
			msg = t('settings.rotate_password_error');
			return;
		}
		if (!confirm(t('settings.rotate_confirm_prompt'))) return;
		busy = true;
		msg = '';
		try {
			const { identity, record } = await generateIdentity(rotatePassword);
			const res = await fetch('/api/identity/rotate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(encodeForWire(record))
			});
			if (!res.ok) {
				msg = await res.text();
				return;
			}
			clearCachedIdentity();
			cacheUnlockedIdentity(identity);
			rotatePassword = '';
			rotateConfirm = '';
			msg = t('settings.identity_rotated');
			// Pessimistic reload of the identities list
			location.reload();
		} catch (e) {
			msg = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<h2>{$_('settings.heading')}</h2>

<section>
	<h3>{$_('settings.account_heading')}</h3>
	<dl>
		<dt>{$_('settings.username_label')}</dt>
		<dd>{data.user.username}</dd>
		<dt>{$_('settings.email_label')}</dt>
		<dd>{data.user.email ?? '—'}</dd>
	</dl>
</section>

<section>
	<h3>{$_('settings.identity_heading')}</h3>
	<ul>
		{#each identities as id}
			<li>
				<code>{id.idc.slice(0, 12)}…</code> · {id.status}
				{#if id.status === 'revoked' && id.revokedAt}
					· revoked {new Date(id.revokedAt).toLocaleString()}
				{/if}
			</li>
		{/each}
	</ul>
	<details>
		<summary>{$_('settings.rotate_identity_summary')}</summary>
		<p>{$_('settings.rotate_identity_blurb')}</p>
		<form on:submit|preventDefault={rotateIdentity}>
			<label>
				{$_('settings.new_password_label')}
				<input
					type="password"
					bind:value={rotatePassword}
					required
					minlength="12"
					autocomplete="new-password"
				/>
			</label>
			<label>
				{$_('settings.confirm_label')}
				<input
					type="password"
					bind:value={rotateConfirm}
					required
					minlength="12"
					autocomplete="new-password"
				/>
			</label>
			<button type="submit" disabled={busy}>{$_('settings.rotate_button')}</button>
		</form>
	</details>
</section>

<section>
	<h3>{$_('settings.sessions_heading')}</h3>
	{#if sessions.length === 0}
		<p>{$_('settings.no_sessions')}</p>
	{:else}
		<ul class="sessions">
			{#each sessions as s}
				<li>
					<div class="meta">
						<div>
							<code title={s.userAgent ?? ''}
								>{(s.userAgent ?? $_('settings.unknown_agent')).slice(0, 80)}</code
							>
							{#if s.current}<span class="tag">{$_('settings.this_device')}</span>{/if}
						</div>
						<small>
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
						<button type="button" disabled={busy} on:click={() => revokeSession(s.id)}>
							{$_('settings.revoke_button')}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h3>Notifications</h3>
	<p class="muted">
		Get a desktop / mobile notification when a post needs review on a blog you moderate, or when a
		new post is published on a blog you belong to. The permission is per-browser; enable on each
		device separately.
	</p>
	{#if pushStatus === 'unsupported'}
		<button type="button" disabled>Push not supported in this browser</button>
	{:else if pushStatus === 'denied'}
		<button type="button" disabled>Notifications blocked — re-enable in browser settings</button>
	{:else if pushStatus === 'subscribed'}
		<button type="button" disabled={pushBusy} on:click={togglePush}>
			Disable push notifications
		</button>
	{:else}
		<button type="button" disabled={pushBusy} on:click={togglePush}>
			Enable push notifications
		</button>
	{/if}
	{#if pushMsg}<p>{pushMsg}</p>{/if}
</section>

<section class="theme">
	<h3>Appearance</h3>
	<p class="muted">
		Choose a theme. "System" follows your operating system's light/dark setting; the other two pin
		the site to that palette across devices that share this browser.
	</p>
	<fieldset class="theme-options">
		<legend class="sr-only">Theme</legend>
		<label class="theme-option">
			<input
				type="radio"
				name="theme"
				value="system"
				checked={themePref === 'system'}
				on:change={() => applyTheme('system')}
			/>
			<span>System</span>
		</label>
		<label class="theme-option">
			<input
				type="radio"
				name="theme"
				value="light"
				checked={themePref === 'light'}
				on:change={() => applyTheme('light')}
			/>
			<span>Light</span>
		</label>
		<label class="theme-option">
			<input
				type="radio"
				name="theme"
				value="dark"
				checked={themePref === 'dark'}
				on:change={() => applyTheme('dark')}
			/>
			<span>Dark</span>
		</label>
	</fieldset>
</section>

<section class="data-rights">
	<h3>{$_('settings.data_rights_heading')}</h3>
	<p>
		{$_('settings.data_rights_blurb_prefix')}
		<a href="/legal/data-rights">{$_('settings.data_rights_link')}</a>
		{$_('settings.data_rights_blurb_suffix')}
	</p>
	<div class="dr-actions">
		<button type="button" disabled={dataBusy} on:click={downloadExport}>
			{$_('settings.download_data')}
		</button>
		{#if !deleteOpen}
			<button
				type="button"
				class="danger"
				disabled={dataBusy}
				on:click={() => {
					deleteOpen = true;
					deleteConfirm = '';
					dataMsg = '';
				}}
			>
				{$_('settings.delete_account')}
			</button>
		{/if}
	</div>
	{#if deleteOpen}
		<div class="dr-modal" role="dialog" aria-modal="true" aria-labelledby="del-h">
			<h4 id="del-h">{$_('settings.confirm_deletion_heading')}</h4>
			<p>{$_('settings.deletion_explanation')}</p>
			<p>
				{$_('settings.deletion_confirm_prompt_prefix')}
				<code>{data.user.username}</code>
				{$_('settings.deletion_confirm_prompt_suffix')}
			</p>
			<form on:submit|preventDefault={deleteAccount} class="del-form">
				<input
					type="text"
					bind:value={deleteConfirm}
					placeholder={data.user.username}
					autocomplete="off"
					aria-label={$_('settings.deletion_aria_label')}
				/>
				<button
					type="submit"
					class="danger"
					disabled={dataBusy || deleteConfirm !== data.user.username}
				>
					{$_('settings.deletion_button')}
				</button>
				<button
					type="button"
					on:click={() => {
						deleteOpen = false;
						deleteConfirm = '';
					}}
					disabled={dataBusy}
				>
					{$_('settings.cancel')}
				</button>
			</form>
		</div>
	{/if}
	{#if dataMsg}<p>{dataMsg}</p>{/if}
</section>

{#if msg}<p>{msg}</p>{/if}

<style>
	section {
		margin: 1rem 0;
	}
	form {
		display: flex;
		gap: 0.5rem;
		align-items: end;
		flex-wrap: wrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
	}
	dt {
		font-weight: 600;
	}
	.sessions {
		list-style: none;
		padding: 0;
	}
	.sessions li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border, #e5e7eb);
		align-items: center;
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.tag {
		display: inline-block;
		background: #eef;
		color: #224;
		padding: 0.05rem 0.4rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		margin-left: 0.5rem;
	}
	.data-rights {
		border-top: 1px solid var(--color-green-light);
		padding-top: 1rem;
	}
	.dr-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
	}
	button.danger,
	:global(button.danger) {
		background-color: var(--color-red) !important;
		color: white !important;
		border-color: var(--color-red-dark);
	}
	button.danger:hover,
	:global(button.danger:hover) {
		background-color: var(--color-red-dark) !important;
		color: white !important;
	}
	.dr-modal {
		border: 1px solid var(--color-red);
		background: var(--color-green-white);
		padding: 1rem;
		border-radius: 0.4rem;
		margin-top: 0.75rem;
	}
	.dr-modal h4 {
		margin-top: 0;
	}
	.del-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.del-form input {
		padding: 0.35rem 0.5rem;
	}
	.muted {
		color: var(--color-text-muted);
		max-width: 60ch;
		font-size: var(--text-sm);
	}
	.theme-options {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		border: 0;
		padding: 0;
		margin: 0;
	}
	.theme-option {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		cursor: pointer;
		min-height: var(--touch-target);
		background: var(--color-surface);
	}
	.theme-option input {
		min-height: 0;
		width: 18px;
		height: 18px;
		margin: 0;
	}
</style>
