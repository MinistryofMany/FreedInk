<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';

	export let data;

	let error = '';

	// ── Invitation pickup (Wave: invitations) ─────────────────────
	// If the URL carries ?invite=<token>, we route the success path through
	// /api/invite/<token>/accept. If the user is already signed in when they
	// land here, accept immediately and redirect. Otherwise the token rides
	// along through the Tessera round-trip via the sign-in link's ?next=.
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

	// Sign-in entry point. When an invite is in play, carry it through the
	// Tessera round-trip so the user lands back on this page (signed in) and
	// the onMount above accepts it.
	$: tesseraHref = inviteToken
		? `/api/auth/oidc/start?next=${encodeURIComponent(`/signup?invite=${inviteToken}`)}`
		: '/api/auth/oidc/start';
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
			<a href="/admin">{$_('auth.signed_in_dashboard_link')}</a>
			{$_('auth.signed_in_suffix')}
		</p>
	{:else if data.signedIn && inviteToken}
		<!-- onMount fires the accept; just show a holding message + retry link. -->
		<p>
			<a href="/admin">{$_('auth.skip_to_dashboard')}</a>
		</p>
	{:else if data.tesseraEnabled}
		<p>Tessera is your identity for Freed.Ink. Sign in to create or access your account.</p>
		<a class="tessera-btn" href={tesseraHref} data-sveltekit-reload>Sign in with Tessera</a>
		<p class="hint">
			New here? Signing in with Tessera for the first time creates your account automatically.
		</p>
	{:else}
		<p class="unavailable">
			Sign-in is currently unavailable: this instance hasn't been configured with a Tessera
			provider. Set the Tessera OIDC environment variables and reload.
		</p>
	{/if}

	{#if error}
		<p style="color: var(--color-red)">{error}</p>
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
	.hint {
		color: var(--color-green-dark);
		font-size: 0.9rem;
	}
	.invite-banner {
		padding: 0.75rem 1rem;
		background: var(--color-green-lightest, #eef5e7);
		border: 1px solid var(--color-green-light, #cfe1bf);
		border-radius: 4px;
	}
	.unavailable {
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--color-red) 8%, transparent);
		border: 1px solid var(--color-red);
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
