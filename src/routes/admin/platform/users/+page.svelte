<script lang="ts">
	import { enhance } from '$app/forms';
	export let data;
	$: ({ users } = data);
</script>

<svelte:head>
	<title>Users — Platform admin</title>
</svelte:head>

<header>
	<p><a href="/admin/platform">&larr; Overview</a></p>
	<h2>Users</h2>
	<p class="note">
		"Suspend" revokes every active session for the user; they will be signed out from all devices. A
		true ban requires a schema change (users.suspended) and is not implemented in this wave — repeat
		offenders can be GDPR-deleted as a stopgap.
	</p>
</header>

{#if users.length === 0}
	<p>No users yet.</p>
{:else}
	<!-- Desktop table. The same data is also rendered as a stacked card list
	     below 768px so the page is usable on a phone screen. -->
	<table class="hide-mobile">
		<thead>
			<tr>
				<th>Username</th>
				<th>Email</th>
				<th>Created</th>
				<th>Last seen</th>
				<th>Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each users as u}
				<tr>
					<td>{u.username}</td>
					<td>{u.email ?? '—'}</td>
					<td>{new Date(u.createdAt).toLocaleDateString()}</td>
					<td>{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '—'}</td>
					<td>
						<form method="POST" action="?/suspend" use:enhance>
							<input type="hidden" name="user_id" value={u.id} />
							<button type="submit">Revoke sessions</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<ul class="card-list show-mobile" aria-label="Users">
		{#each users as u}
			<li class="card">
				<dl>
					<div>
						<dt>Username</dt>
						<dd>{u.username}</dd>
					</div>
					<div>
						<dt>Email</dt>
						<dd>{u.email ?? '—'}</dd>
					</div>
					<div>
						<dt>Created</dt>
						<dd>{new Date(u.createdAt).toLocaleDateString()}</dd>
					</div>
					<div>
						<dt>Last seen</dt>
						<dd>{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '—'}</dd>
					</div>
				</dl>
				<div class="card-actions">
					<form method="POST" action="?/suspend" use:enhance>
						<input type="hidden" name="user_id" value={u.id} />
						<button type="submit">Revoke sessions</button>
					</form>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	header {
		margin-bottom: 1.5rem;
	}
	.note {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		max-width: 60ch;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	th,
	td {
		border-bottom: 1px solid var(--color-border);
		padding: 0.6rem 0.5rem;
		text-align: left;
		color: var(--color-text);
	}
	th {
		background: var(--color-surface-alt);
	}

	.card-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.85rem 1rem;
		box-shadow: var(--shadow-elev-1);
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.card dl {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.35rem 1rem;
		margin: 0;
	}
	.card dl > div {
		display: grid;
		grid-template-columns: minmax(6rem, auto) 1fr;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	.card dt {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.card dd {
		margin: 0;
		color: var(--color-text);
		word-break: break-word;
	}
	.card-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.card-actions :global(form),
	.card-actions :global(button) {
		width: 100%;
	}

	.show-mobile {
		display: none;
	}
	.hide-mobile {
		display: table;
	}
	@media (max-width: 767px) {
		.show-mobile {
			display: flex;
		}
		.hide-mobile {
			display: none;
		}
	}
</style>
