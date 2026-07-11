<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { _ } from '$lib/i18n';
	import { Card, Button, Kicker } from '$lib/components/ui';

	export let data;

	let error = '';

	// ── Invitation pickup (Wave: invitations) ─────────────────────
	// If the URL carries ?invite=<token>, we route the success path through
	// /api/invite/<token>/accept. If the user is already signed in when they
	// land here, accept immediately and redirect. Otherwise the token rides
	// along through the Minister round-trip via the sign-in link's ?next=.
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
	// Minister round-trip so the user lands back on this page (signed in) and
	// the onMount above accepts it.
	$: ministerHref = inviteToken
		? `/api/auth/oidc/start?next=${encodeURIComponent(`/signup?invite=${inviteToken}`)}`
		: '/api/auth/oidc/start';
</script>

<svelte:head>
	<title>Sign in — FreedInk</title>
</svelte:head>

<div class="page-wrap">
	<Card padding="lg" elevated>
		<div class="stack">
			<Kicker>FreedInk</Kicker>
			<h1 class="heading">{$_('auth.signup_heading')}</h1>

			{#if inviteToken}
				<div class="banner banner--accent">
					<p>
						{$_('auth.invite_banner_accepting')}
						{#if data.signedIn}
							{$_('auth.invite_banner_signed_in')}
						{:else}
							{$_('auth.invite_banner_signed_out')}
						{/if}
					</p>
				</div>
			{/if}

			{#if data.signedIn && !inviteToken}
				<div class="banner banner--accent">
					<p>
						{$_('auth.signed_in_prefix')}
						<strong>{data.username}</strong>.
						<a href="/admin">{$_('auth.signed_in_dashboard_link')}</a>
						{$_('auth.signed_in_suffix')}
					</p>
				</div>
			{:else if data.signedIn && inviteToken}
				<!-- onMount fires the accept; just show a holding message + retry link. -->
				<p class="muted"><a href="/admin">{$_('auth.skip_to_dashboard')}</a></p>
			{:else if data.ministerEnabled}
				<p class="body-text">
					Minister is how you sign in to FreedInk. It vouches for you without oversharing
					(FreedInk never even sees your email).
				</p>
				<Button href={ministerHref} variant="primary" data-sveltekit-reload>
					Sign in with Minister
				</Button>
				<p class="hint">
					New here? Signing in with Minister for the first time creates your account automatically.
				</p>
			{:else}
				<div class="banner banner--danger">
					<p>
						Sign-in is currently unavailable: this instance hasn't been configured with a Minister
						provider. Set the Minister OIDC environment variables and reload.
					</p>
				</div>
			{/if}

			{#if error}
				<p class="error">{error}</p>
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

	.hint {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.muted {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		margin: 0;
	}

	.banner {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-surface-alt);
	}

	.banner p {
		margin: 0;
	}

	.banner--accent {
		border-left: var(--border-2) solid var(--color-accent);
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
</style>
