<script lang="ts">
	import { startRegistration } from '@simplewebauthn/browser';
	import { goto } from '$app/navigation';
	import { _ } from '$lib/i18n';

	export let data: {
		token: string | null;
		valid: boolean;
		email: string | null;
		username?: string;
	};

	let email = '';
	let busy = false;
	let msg = '';
	let sent = false;

	async function requestRecovery() {
		busy = true;
		msg = '';
		try {
			await fetch('/api/auth/recovery/start', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email })
			});
			// Always treat as success — server intentionally returns a neutral
			// response regardless of whether the email exists.
			sent = true;
		} catch (e) {
			msg = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function registerNewPasskey() {
		if (!data.token) return;
		busy = true;
		msg = '';
		try {
			const optsRes = await fetch('/api/auth/recovery/options', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: data.token })
			});
			if (!optsRes.ok) {
				msg = await optsRes.text();
				return;
			}
			const { options } = await optsRes.json();
			const att = await startRegistration({ optionsJSON: options });
			const finRes = await fetch('/api/auth/recovery/finish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: data.token, response: att })
			});
			if (!finRes.ok) {
				msg = await finRes.text();
				return;
			}
			// Land on /admin after recovery so the user sees their account again.
			await goto('/admin');
		} catch (e) {
			msg = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<h2>{$_('recover.heading')}</h2>

{#if !data.token}
	<p>{$_('recover.prompt')}</p>
	{#if sent}
		<p>{$_('recover.sent_neutral')}</p>
		<p><a href="/signup">{$_('recover.back_to_signin')}</a></p>
	{:else}
		<form on:submit|preventDefault={requestRecovery}>
			<label>
				{$_('recover.email_label')}
				<input type="email" bind:value={email} required autocomplete="email" />
			</label>
			<button type="submit" disabled={busy || !email}>{$_('recover.send_link')}</button>
		</form>
	{/if}
{:else if !data.valid}
	<p>{$_('recover.invalid_link')}</p>
	<p><a href="/recover">{$_('recover.request_new')}</a></p>
{:else}
	<p>
		{$_('recover.recovering_for', {
			values: { email: data.email ?? '', username: data.username ?? '' }
		})}
	</p>
	<aside class="warning">
		<strong>{$_('recover.warning_heading')}</strong>
		{$_('recover.warning_body')}<em>{$_('recover.warning_emph')}</em>
		{$_('recover.warning_suffix')}
		<a href="/settings">/settings</a>.
	</aside>
	<button type="button" on:click={registerNewPasskey} disabled={busy}>
		{busy ? $_('recover.working') : $_('recover.register_new_passkey')}
	</button>
{/if}

{#if msg}<p class="error">{msg}</p>{/if}

<style>
	form {
		display: flex;
		gap: 0.5rem;
		align-items: end;
		flex-wrap: wrap;
		margin: 1rem 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.warning {
		background: #fff7e6;
		border-left: 3px solid #d97706;
		padding: 0.75rem 1rem;
		margin: 1rem 0;
	}
	.error {
		color: #b00020;
	}
</style>
