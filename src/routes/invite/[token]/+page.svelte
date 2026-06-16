<script lang="ts">
	import { goto } from '$app/navigation';
	import { Card, Button, Kicker } from '$lib/components/ui';

	export let data;

	let busy = false;
	let error = '';

	async function accept() {
		busy = true;
		error = '';
		try {
			const res = await fetch(`/api/invite/${data.token}/accept`, { method: 'POST' });
			if (!res.ok) {
				error = await res.text();
				return;
			}
			const json = await res.json();
			goto(`/admin/b/${json.blog_slug}/manage`);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<section class="invite">
	<Card padding="lg" elevated>
		{#if !data.invitation}
			<Kicker>Invitation</Kicker>
			<h1>Invitation unavailable</h1>
			<p>
				This invitation link is invalid, expired, or has already been used. Ask the person who
				invited you to send a new one.
			</p>
			<p><a href="/">Back to home</a></p>
		{:else}
			<Kicker>You're invited</Kicker>
			<h1>Join <em>{data.invitation.blogTitle}</em></h1>
			<p>
				<strong>{data.invitation.inviterUsername}</strong> invited you to join
				<strong>{data.invitation.blogTitle}</strong> as a
				<strong>{data.invitation.role}</strong>.
			</p>
			<p class="meta">Expires {new Date(data.invitation.expiresAt).toLocaleString()}.</p>

			{#if data.signedIn}
				<p>You're signed in as <strong>{data.username}</strong>.</p>
				<Button onclick={accept} loading={busy}>
					{busy ? 'Accepting…' : 'Accept invitation'}
				</Button>
			{:else}
				<p>Sign in or create an account to accept this invitation.</p>
				<Button href="/signup?invite={data.token}">Sign up / Sign in</Button>
			{/if}

			{#if error}
				<p class="error">{error}</p>
			{/if}
		{/if}
	</Card>
</section>

<style>
	.invite {
		max-width: 36rem;
		margin: var(--space-8) auto;
		padding: 0 var(--space-4);
	}
	.invite :global(h1) {
		font-size: var(--text-2xl);
		margin: var(--space-2) 0 var(--space-4);
	}
	.invite p {
		margin: 0 0 var(--space-3);
	}
	.meta {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.error {
		margin-top: var(--space-3);
		color: var(--color-danger);
	}
</style>
