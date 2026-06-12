<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
	import SIWE from '$lib/components/siwe.svelte';
	import { _ } from '$lib/i18n';

	export let data;

	let email = '';
	let username = '';
	let mode: 'register' | 'login' = 'register';
	let busy = false;
	let error = '';

	$: webauthnAvailable = browser ? browserSupportsWebAuthn() : true;

	// ── Invitation pickup (Wave: invitations) ─────────────────────
	// If the URL carries ?invite=<token>, we route the success path through
	// /api/invite/<token>/accept instead of /admin. If the user is already
	// signed in when they land here, accept immediately and redirect.
	let inviteToken: string | null = null;

	async function acceptInviteAndRedirect(token: string): Promise<boolean> {
		const res = await fetch(`/api/invite/${token}/accept`, { method: 'POST' });
		if (res.ok) {
			const json = await res.json();
			goto(`/admin/b/${json.blog_slug}/manage`);
			return true;
		}
		error = await res.text();
		return false;
	}

	onMount(() => {
		if (!browser) return;
		inviteToken = $page.url.searchParams.get('invite');
		if (inviteToken && data.signedIn) {
			void acceptInviteAndRedirect(inviteToken);
		}
	});

	async function registerPasskey() {
		busy = true;
		error = '';
		try {
			const startRes = await fetch('/api/auth/register/start', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, username })
			});
			if (!startRes.ok) {
				error = await startRes.text();
				return;
			}
			const { user_id, options } = await startRes.json();
			const attResp = await startRegistration({ optionsJSON: options });
			const finishRes = await fetch('/api/auth/register/finish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ user_id, response: attResp, nickname: 'default' })
			});
			if (!finishRes.ok) {
				error = await finishRes.text();
				return;
			}
			// Accept the invite right after the session lands (before identity
			// setup) so the membership is in place. Acceptance only requires a
			// valid session — identity creation is a separate step the user
			// completes next at /signup/identity.
			if (inviteToken) {
				const res = await fetch(`/api/invite/${inviteToken}/accept`, { method: 'POST' });
				if (!res.ok) {
					// Surface but still proceed to identity setup — the user can
					// re-open the invite link later if it failed transiently.
					error = `invite acceptance failed: ${await res.text()}`;
				}
			}
			goto('/signup/identity');
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function loginPasskey() {
		busy = true;
		error = '';
		try {
			const startRes = await fetch('/api/auth/login/start', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: email || undefined })
			});
			if (!startRes.ok) {
				error = await startRes.text();
				return;
			}
			const { options } = await startRes.json();
			const assertion = await startAuthentication({ optionsJSON: options });
			const finishRes = await fetch('/api/auth/login/finish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ response: assertion, email: email || undefined })
			});
			if (!finishRes.ok) {
				error = await finishRes.text();
				return;
			}
			if (inviteToken) {
				const accepted = await acceptInviteAndRedirect(inviteToken);
				if (accepted) return;
			}
			goto('/admin');
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<section class="stack">
	<h2>{$_('auth.signup_heading')}</h2>

	{#if inviteToken}
		<p class="invite-banner">
			{$_('auth.invite_banner_accepting')}
			{#if data.signedIn}
				{$_('auth.invite_banner_signed_in')}
			{:else}
				{$_('auth.invite_banner_signed_out')}
			{/if}
		</p>
	{/if}

	{#if data.signedIn && !inviteToken}
		<p>
			{$_('auth.signed_in_prefix')}
			<strong>{data.username}</strong>.
			<!-- "Go to your dashboard" — split for translator-friendly link wrap. -->
			<a href="/admin">{$_('auth.signed_in_dashboard_link')}</a>
			{$_('auth.signed_in_suffix')}
		</p>
	{:else if data.signedIn && inviteToken}
		<!-- onMount fires the accept; just show a holding message + retry link. -->
		<p>
			<a href="/admin">{$_('auth.skip_to_dashboard')}</a>
		</p>
	{:else}
		<div class="tabs">
			<button class:active={mode === 'register'} on:click={() => (mode = 'register')}>
				{$_('auth.create_account_tab')}
			</button>
			<button class:active={mode === 'login'} on:click={() => (mode = 'login')}>
				{$_('auth.sign_in_tab')}
			</button>
		</div>

		{#if mode === 'register'}
			<form on:submit|preventDefault={registerPasskey}>
				<label>
					{$_('auth.email_label')}
					<input type="email" bind:value={email} required autocomplete="email" />
				</label>
				<label>
					{$_('auth.username_label')}
					<input bind:value={username} required minlength="3" autocomplete="username" />
				</label>
				<button type="submit" disabled={busy || !webauthnAvailable}>
					{webauthnAvailable ? $_('auth.register_passkey') : $_('auth.passkey_unsupported')}
				</button>
			</form>
		{:else}
			<form on:submit|preventDefault={loginPasskey}>
				<label>
					{$_('auth.email_optional_label')}
					<input type="email" bind:value={email} autocomplete="email" />
				</label>
				<button type="submit" disabled={busy || !webauthnAvailable}>
					{$_('auth.signin_passkey')}
				</button>
			</form>
		{/if}

		{#if error}
			<p style="color: var(--color-red)">{error}</p>
		{/if}

		<hr />

		<p>{$_('auth.prefer_wallet')}</p>
		<SIWE address={null} />

		{#if data.tesseraEnabled}
			<hr />
			<p>Or use your Tessera identity:</p>
			<a class="tessera-btn" href="/api/auth/oidc/start" data-sveltekit-reload>
				Sign in with Tessera
			</a>
		{/if}
	{/if}
</section>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 36rem;
		margin: 3rem auto;
	}
	.tabs {
		display: flex;
		gap: 0.5rem;
	}
	.tabs .active {
		background: var(--color-green-light) !important;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	hr {
		border: none;
		border-top: 1px solid var(--color-green-light);
		margin: 0.5rem 0;
	}
	.invite-banner {
		padding: 0.75rem 1rem;
		background: var(--color-green-lightest, #eef5e7);
		border: 1px solid var(--color-green-light, #cfe1bf);
		border-radius: 4px;
	}
	.tessera-btn {
		display: inline-block;
		text-align: center;
		padding: 0.6rem 1rem;
		border: 1px solid var(--color-green-light, #cfe1bf);
		border-radius: 4px;
		background: var(--color-green-lightest, #eef5e7);
		color: inherit;
		text-decoration: none;
		font-weight: 600;
	}
	.tessera-btn:hover {
		background: var(--color-green-light, #cfe1bf);
	}
</style>
