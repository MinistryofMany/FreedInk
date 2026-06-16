<script lang="ts">
	import { enhance } from '$app/forms';
	import { Table, Button, AlertDialog, EmptyState, Kicker } from '$lib/components/ui';

	export let data;
	$: ({ users } = data);

	const columns = [
		{ key: 'username', label: 'Username' },
		{ key: 'email', label: 'Email' },
		{ key: 'created', label: 'Created' },
		{ key: 'last_seen', label: 'Last seen' },
		{ key: 'actions', label: 'Actions' }
	];

	// Per-row state: which user's dialog is open, and a reference to their form.
	let pendingUserId: string | null = null;
	let dialogOpen = false;
	// Map of user id -> form element, populated via bind:this in each cell.
	let suspendForms: Record<string, HTMLFormElement> = {};

	function openDialog(userId: string) {
		pendingUserId = userId;
		dialogOpen = true;
	}

	function confirmSuspend() {
		if (pendingUserId && suspendForms[pendingUserId]) {
			suspendForms[pendingUserId].requestSubmit();
		}
		pendingUserId = null;
	}
</script>

<svelte:head>
	<title>Users — Platform admin</title>
</svelte:head>

<div class="page-header">
	<p class="back-link"><a href="/admin/platform">&larr; Overview</a></p>
	<Kicker>Platform admin</Kicker>
	<h2 class="page-title">Users</h2>
	<p class="note">
		"Revoke sessions" signs the user out from all devices immediately. A permanent ban requires a
		schema change and is not implemented — repeat offenders can be GDPR-deleted as a stopgap.
	</p>
</div>

<Table {columns} rows={users} caption="Platform users">
	{#snippet cell(row, col)}
		{#if col.key === 'username'}
			{row.username}
		{:else if col.key === 'email'}
			{row.email ?? '—'}
		{:else if col.key === 'created'}
			{new Date(row.createdAt).toLocaleDateString()}
		{:else if col.key === 'last_seen'}
			{row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—'}
		{:else if col.key === 'actions'}
			<form
				method="POST"
				action="?/suspend"
				use:enhance
				bind:this={suspendForms[row.id]}
				class="suspend-form"
			>
				<input type="hidden" name="user_id" value={row.id} />
				<Button variant="danger" size="sm" onclick={() => openDialog(row.id)}>
					Revoke sessions
				</Button>
			</form>
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="No users yet" />
	{/snippet}
</Table>

<AlertDialog
	bind:open={dialogOpen}
	title="Revoke all sessions?"
	description="This will immediately sign the user out from every device. They can sign back in unless further action is taken."
	confirmLabel="Revoke sessions"
	cancelLabel="Cancel"
	tone="danger"
	onConfirm={confirmSuspend}
/>

<style>
	.page-header {
		margin-bottom: var(--space-5);
	}

	.back-link {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0 0 var(--space-2);
	}

	.back-link a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.back-link a:hover {
		text-decoration: underline;
	}

	.page-title {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		color: var(--color-text);
		margin: var(--space-1) 0 0;
	}

	.note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		max-width: 60ch;
		margin: var(--space-2) 0 0;
	}

	.suspend-form {
		display: contents;
	}
</style>
