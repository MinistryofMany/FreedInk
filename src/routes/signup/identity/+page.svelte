<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		generateIdentity,
		encodeForWire,
		cacheUnlockedIdentity,
		exportMnemonic
	} from '$lib/client/vault';
	import { _ } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { Card, Field, Button, Kicker } from '$lib/components/ui';

	export let data;

	// Carried through from the Minister callback when the user arrived mid-flow
	// (e.g. accepting an invitation). Only same-origin paths are produced upstream.
	function safeNext(raw: string | null): string {
		if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
		return '/admin';
	}
	let password = '';
	let confirm = '';
	// Pre-filled from anything Minister disclosed at sign-in; otherwise blank.
	// Optional — left empty, the auto-generated username is used everywhere.
	let displayName = data.displayName ?? '';
	let busy = false;
	let error = '';

	// Recovery-phrase step: after the identity is created and stored, we show the
	// 24-word mnemonic once and make the user acknowledge saving it before leaving.
	let recoveryPhrase: string | null = null;
	let recoveryAck = false;
	let recoveryCopied = false;
	let pendingNext = '/admin';

	async function copyRecovery() {
		if (!recoveryPhrase) return;
		try {
			await navigator.clipboard.writeText(recoveryPhrase);
			recoveryCopied = true;
			setTimeout(() => (recoveryCopied = false), 1500);
		} catch {
			// Clipboard may be blocked; the phrase stays visible for manual copy.
			recoveryCopied = false;
		}
	}

	function finishSetup() {
		goto(pendingNext);
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		void create();
	}

	async function create() {
		const t = get(_);
		if (password.length < 12) {
			error = t('identity.error_min_length');
			return;
		}
		if (password !== confirm) {
			error = t('identity.error_mismatch');
			return;
		}
		busy = true;
		error = '';
		try {
			const { identity, record } = await generateIdentity(password);
			const res = await fetch('/api/identity', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(encodeForWire(record))
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			// Persist the chosen display name (best effort — the account is already
			// usable without one, so a failure here shouldn't block the flow). Only
			// send it when it differs from what's already stored.
			const trimmed = displayName.trim();
			if (trimmed !== (data.displayName ?? '')) {
				const profileRes = await fetch('/api/user', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ displayName: trimmed === '' ? null : trimmed })
				});
				if (!profileRes.ok) {
					error = await profileRes.text();
					return;
				}
			}
			cacheUnlockedIdentity(identity);
			// Show the one-time recovery phrase before leaving. Generating the
			// mnemonic can't fail for a fresh 32-byte identity, but if it somehow
			// does, don't strand the user — fall through to the normal redirect.
			pendingNext = safeNext($page.url.searchParams.get('next'));
			try {
				recoveryPhrase = await exportMnemonic(identity);
			} catch {
				goto(pendingNext);
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Identity setup — FreedInk</title>
</svelte:head>

<div class="page-wrap">
	<Card padding="lg" elevated>
		<div class="stack">
			<Kicker>Identity setup</Kicker>
			<h1 class="heading">{$_('identity.set_password_heading')}</h1>
			<p class="body-text">
				{$_('identity.intro', { values: { username: data.username } })}
				<strong>{$_('identity.cannot_recover')}</strong>
				{$_('identity.forgot_warning')}
			</p>

			{#if recoveryPhrase}
				<div class="recovery">
					<h2 class="recovery-heading">{$_('identity.recovery_heading')}</h2>
					<p class="body-text">{$_('identity.recovery_blurb')}</p>
					<pre class="recovery-phrase" aria-label={$_('identity.recovery_heading')}>{recoveryPhrase}</pre>
					<div class="recovery-actions">
						<Button variant="ghost" onclick={copyRecovery}>
							{recoveryCopied ? $_('identity.recovery_copied') : $_('identity.recovery_copy')}
						</Button>
					</div>
					<p class="banner banner--danger">{$_('identity.recovery_warning')}</p>
					<label class="recovery-ack">
						<input type="checkbox" bind:checked={recoveryAck} />
						<span>{$_('identity.recovery_ack')}</span>
					</label>
					<Button variant="primary" disabled={!recoveryAck} onclick={finishSetup}>
						{$_('identity.recovery_continue')}
					</Button>
				</div>
			{:else if data.hasIdentity}
				<div class="banner banner--danger">
					<p>{$_('identity.already_have')}</p>
				</div>
				<Button href="/settings" variant="ghost">{$_('identity.go_to_settings')}</Button>
			{:else}
				<form onsubmit={handleSubmit} class="form">
					<Field
						label={$_('identity.display_name_label')}
						bind:value={displayName}
						placeholder={$_('identity.display_name_placeholder')}
						help={$_('identity.display_name_hint')}
						maxlength={80}
						autocomplete="nickname"
					/>

					<div class="field">
						<label for="password" class="field-label"
							>{$_('identity.password_label')}<span class="required" aria-hidden="true">
								*</span
							></label
						>
						<input
							id="password"
							type="password"
							bind:value={password}
							required
							minlength="12"
							autocomplete="new-password"
							aria-required="true"
						/>
					</div>

					<div class="field">
						<label for="confirm" class="field-label"
							>{$_('identity.confirm_label')}<span class="required" aria-hidden="true">
								*</span
							></label
						>
						<input
							id="confirm"
							type="password"
							bind:value={confirm}
							required
							minlength="12"
							autocomplete="new-password"
							aria-required="true"
						/>
					</div>

					{#if error}
						<p class="error" role="alert">{error}</p>
					{/if}

					<Button type="submit" variant="primary" loading={busy}>
						{busy ? $_('identity.generating') : $_('identity.create_button')}
					</Button>
				</form>
			{/if}
		</div>
	</Card>
</div>

<style>
	.page-wrap {
		max-width: 36rem;
		margin: var(--space-8) auto;
		padding: 0 var(--space-4);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.heading {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
		line-height: 1.2;
	}

	.body-text {
		color: var(--color-text);
		margin: 0;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Native labeled inputs matching Field's visual pattern */
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.required {
		color: var(--color-danger);
	}

	.banner {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-surface-alt);
	}

	.banner p {
		margin: 0;
	}

	.banner--danger {
		border-left: var(--border-2) solid var(--color-danger);
		color: var(--color-danger);
	}

	.error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-danger);
	}

	.recovery {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.recovery-heading {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--color-text);
		margin: 0;
	}

	.recovery-phrase {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--text-base);
		line-height: 1.8;
		color: var(--color-text);
		background: var(--color-surface-alt);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		margin: 0;
		white-space: pre-wrap;
		word-spacing: 0.3em;
	}

	.recovery-actions {
		display: flex;
		gap: var(--space-3);
	}

	.recovery-ack {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
	}
</style>
