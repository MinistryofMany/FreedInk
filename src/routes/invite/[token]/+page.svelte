<script lang="ts">
	import { goto } from '$app/navigation';

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
	{#if !data.invitation}
		<h2>Invitation unavailable</h2>
		<p>
			This invitation link is invalid, expired, or has already been used. Ask the person who
			invited you to send a new one.
		</p>
		<p><a href="/">Back to home</a></p>
	{:else}
		<h2>You're invited to <em>{data.invitation.blogTitle}</em></h2>
		<p>
			<strong>{data.invitation.inviterUsername}</strong> invited you to join
			<strong>{data.invitation.blogTitle}</strong> as a
			<strong>{data.invitation.role}</strong>.
		</p>
		<p class="meta">Expires {new Date(data.invitation.expiresAt).toLocaleString()}.</p>

		{#if data.signedIn}
			<p>You're signed in as <strong>{data.username}</strong>.</p>
			<button type="button" class="primary" on:click={accept} disabled={busy}>
				{busy ? 'Accepting…' : 'Accept invitation'}
			</button>
		{:else}
			<p>Sign in or create an account to accept this invitation.</p>
			<a class="primary btn" href="/signup?invite={data.token}">Sign up / Sign in</a>
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	{/if}
</section>

<style>
	.invite {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 36rem;
		margin: 3rem auto;
	}
	.meta {
		color: var(--color-green-dark, #54635a);
		font-size: 0.9rem;
	}
	.primary {
		display: inline-block;
		padding: 0.6rem 1.1rem;
		background: var(--color-green);
		color: var(--color-green-lightest);
		text-decoration: none;
		border-radius: 4px;
		font-weight: 600;
		border: none;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.error {
		color: var(--color-red);
	}
</style>
