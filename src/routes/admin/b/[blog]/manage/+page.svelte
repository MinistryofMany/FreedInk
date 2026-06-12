<script lang="ts">
	export let data;
	let members = data.members;
	let blog = data.blog;

	const ROLES = ['owner', 'editor', 'reviewer', 'author', 'commenter'] as const;
	type Role = (typeof ROLES)[number];

	let addUsername = '';
	let addRole: Role = 'author';
	let busy = false;
	let msg = '';

	// ── Invitations (Wave: invitations) ─────────────────────────────
	let invitations = data.invitations;
	let inviteEmail = '';
	let inviteRole: Role = 'author';
	let inviteBusy = false;
	let inviteMsg = '';

	$: pendingInvitations = invitations.filter((i) => i.acceptedAt === null && i.revokedAt === null);
	$: recentDecisions = invitations
		.filter((i) => i.acceptedAt !== null || i.revokedAt !== null)
		.slice(0, 10);

	async function refreshInvitations() {
		const res = await fetch(`/api/blog/invite?blog_id=${blog.id}`);
		if (res.ok) {
			const json = await res.json();
			invitations = json.invitations.map(
				(i: {
					expires_at: string;
					created_at: string;
					accepted_at: string | null;
					revoked_at: string | null;
					id: string;
					email: string;
					role: Role;
					accepted_by_username: string | null;
					invited_by_username: string;
				}) => ({
					id: i.id,
					email: i.email,
					role: i.role,
					expiresAt: i.expires_at,
					createdAt: i.created_at,
					acceptedAt: i.accepted_at,
					revokedAt: i.revoked_at,
					acceptedByUsername: i.accepted_by_username,
					invitedByUsername: i.invited_by_username
				})
			);
		}
	}

	async function sendInvite() {
		if (!inviteEmail) return;
		inviteBusy = true;
		inviteMsg = '';
		try {
			const res = await fetch('/api/blog/invite', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ blog_id: blog.id, email: inviteEmail, role: inviteRole })
			});
			if (res.ok) {
				inviteEmail = '';
				inviteMsg = 'Invitation sent.';
				await refreshInvitations();
			} else {
				inviteMsg = await res.text();
			}
		} finally {
			inviteBusy = false;
		}
	}

	async function revokeInvite(id: string) {
		inviteBusy = true;
		inviteMsg = '';
		try {
			const res = await fetch(`/api/blog/invite/${id}`, { method: 'DELETE' });
			if (res.ok) {
				await refreshInvitations();
			} else {
				inviteMsg = await res.text();
			}
		} finally {
			inviteBusy = false;
		}
	}

	async function setRole(target: { user_id?: string; username?: string }, role: Role) {
		busy = true;
		msg = '';
		const res = await fetch('/api/blog/members', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ blog_id: blog.id, target, role })
		});
		busy = false;
		if (res.ok) {
			const json = await res.json();
			members = members.filter((m) => m.username !== json.member.username);
			members = [
				...members,
				{
					id: json.member.user_id,
					user_id: json.member.user_id,
					username: json.member.username,
					displayName: null,
					role: json.member.role,
					addedAt: new Date()
				}
			];
		} else {
			msg = await res.text();
		}
	}

	function onRoleChange(user_id: string, ev: Event) {
		const target = ev.currentTarget as HTMLSelectElement;
		setRole({ user_id }, target.value as Role);
	}

	async function remove(user_id: string) {
		busy = true;
		const res = await fetch('/api/blog/members', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ blog_id: blog.id, target_user_id: user_id })
		});
		busy = false;
		if (res.ok) members = members.filter((m) => m.user_id !== user_id);
		else msg = await res.text();
	}

	async function addUser() {
		if (!addUsername) return;
		await setRole({ username: addUsername }, addRole);
		addUsername = '';
	}
</script>

<h3>Manage {blog.title}</h3>
<p><a href="/admin/b/{blog.slug}/author" class="btn">Write a post</a></p>

<!-- Errors are announced to assistive tech via the polite live region. -->
<p
	class="status"
	role="status"
	aria-live="polite"
	style:color={msg ? 'var(--color-red)' : 'inherit'}
>
	{msg}
</p>

<!-- Members: desktop table for >=768px, stacked cards below. -->
<div class="members">
	<table class="hide-mobile">
		<thead>
			<tr>
				<th>Username</th>
				<th>Role</th>
				<th>Change to</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each members as m (m.user_id)}
				<tr>
					<td>{m.username}</td>
					<td>{m.role}</td>
					<td>
						<select
							value={m.role}
							on:change={(e) => onRoleChange(m.user_id, e)}
							disabled={busy}
							aria-label="Change role for {m.username}"
						>
							{#each ROLES as r}
								<option value={r}>{r}</option>
							{/each}
						</select>
					</td>
					<td>
						<button class="remove" disabled={busy} on:click={() => remove(m.user_id)}>
							Remove
						</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<ul class="card-list show-mobile" aria-label="Members">
		{#each members as m (m.user_id)}
			<li class="card">
				<dl>
					<div>
						<dt>Username</dt>
						<dd>{m.username}</dd>
					</div>
					<div>
						<dt>Role</dt>
						<dd>{m.role}</dd>
					</div>
					<div>
						<dt>
							<label for="role-{m.user_id}">Change to</label>
						</dt>
						<dd>
							<select
								id="role-{m.user_id}"
								value={m.role}
								on:change={(e) => onRoleChange(m.user_id, e)}
								disabled={busy}
							>
								{#each ROLES as r}
									<option value={r}>{r}</option>
								{/each}
							</select>
						</dd>
					</div>
				</dl>
				<div class="card-actions">
					<button class="remove" disabled={busy} on:click={() => remove(m.user_id)}>
						Remove
					</button>
				</div>
			</li>
		{/each}
	</ul>
</div>

<h4>Add a member</h4>
<form on:submit|preventDefault={addUser}>
	<label>
		Username
		<input bind:value={addUsername} required minlength="3" />
	</label>
	<label>
		Role
		<select bind:value={addRole}>
			{#each ROLES as r}
				<option value={r}>{r}</option>
			{/each}
		</select>
	</label>
	<button type="submit" disabled={busy}>Add</button>
</form>

<section class="invitations">
	<h4>Invitations</h4>

	{#if inviteMsg}
		<p class="invite-msg">{inviteMsg}</p>
	{/if}

	<form on:submit|preventDefault={sendInvite}>
		<label>
			Email
			<input type="email" bind:value={inviteEmail} required autocomplete="off" />
		</label>
		<label>
			Role
			<select bind:value={inviteRole}>
				{#each ROLES as r}
					<option value={r}>{r}</option>
				{/each}
			</select>
		</label>
		<button type="submit" disabled={inviteBusy}>Send invite</button>
	</form>

	<h5>Pending</h5>
	{#if pendingInvitations.length === 0}
		<p class="empty">No pending invitations.</p>
	{:else}
		<table class="hide-mobile">
			<thead>
				<tr>
					<th>Email</th>
					<th>Role</th>
					<th>Expires</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each pendingInvitations as inv (inv.id)}
					<tr>
						<td>{inv.email}</td>
						<td>{inv.role}</td>
						<td>{new Date(inv.expiresAt).toLocaleString()}</td>
						<td>
							<button
								type="button"
								class="remove"
								disabled={inviteBusy}
								on:click={() => revokeInvite(inv.id)}
							>
								Revoke
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<ul class="card-list show-mobile" aria-label="Pending invitations">
			{#each pendingInvitations as inv (inv.id)}
				<li class="card">
					<dl>
						<div>
							<dt>Email</dt>
							<dd>{inv.email}</dd>
						</div>
						<div>
							<dt>Role</dt>
							<dd>{inv.role}</dd>
						</div>
						<div>
							<dt>Expires</dt>
							<dd>{new Date(inv.expiresAt).toLocaleString()}</dd>
						</div>
					</dl>
					<div class="card-actions">
						<button
							type="button"
							class="remove"
							disabled={inviteBusy}
							on:click={() => revokeInvite(inv.id)}
						>
							Revoke
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if recentDecisions.length > 0}
		<h5>Recent</h5>
		<table class="hide-mobile">
			<thead>
				<tr>
					<th>Email</th>
					<th>Role</th>
					<th>Status</th>
					<th>When</th>
				</tr>
			</thead>
			<tbody>
				{#each recentDecisions as inv (inv.id)}
					<tr>
						<td>{inv.email}</td>
						<td>{inv.role}</td>
						<td>
							{#if inv.acceptedAt}
								Accepted{inv.acceptedByUsername ? ` by ${inv.acceptedByUsername}` : ''}
							{:else if inv.revokedAt}
								Revoked
							{/if}
						</td>
						<td>
							{new Date(inv.acceptedAt ?? inv.revokedAt ?? inv.createdAt).toLocaleString()}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<ul class="card-list show-mobile" aria-label="Recent invitation decisions">
			{#each recentDecisions as inv (inv.id)}
				<li class="card">
					<dl>
						<div>
							<dt>Email</dt>
							<dd>{inv.email}</dd>
						</div>
						<div>
							<dt>Role</dt>
							<dd>{inv.role}</dd>
						</div>
						<div>
							<dt>Status</dt>
							<dd>
								{#if inv.acceptedAt}
									Accepted{inv.acceptedByUsername ? ` by ${inv.acceptedByUsername}` : ''}
								{:else if inv.revokedAt}
									Revoked
								{/if}
							</dd>
						</div>
						<div>
							<dt>When</dt>
							<dd>{new Date(inv.acceptedAt ?? inv.revokedAt ?? inv.createdAt).toLocaleString()}</dd>
						</div>
					</dl>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 1rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.6rem 0.5rem;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}
	th {
		background: var(--color-green);
		color: var(--color-green-white);
	}
	form {
		display: flex;
		flex-direction: row;
		gap: 1rem;
		align-items: end;
		flex-wrap: wrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.remove {
		background: var(--color-red) !important;
		color: white !important;
		border-color: var(--color-red-dark) !important;
	}
	.invitations {
		margin-top: 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.invitations h5 {
		margin: 1rem 0 0.25rem 0;
	}
	.invite-msg {
		color: var(--color-text-muted);
	}
	.empty {
		color: var(--color-text-muted);
		font-style: italic;
	}
	.status {
		min-height: 1.4em;
		margin: 0.25rem 0 0.75rem;
	}

	/* Responsive table → card swap. We keep the data flow identical between
	   the two layouts so the role-change / revoke behavior never has to ask
	   what viewport it's on. */
	.card-list {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
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
		align-items: center;
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
		align-items: stretch;
	}
	.card-actions :global(button) {
		width: 100%;
	}

	/* Visibility flips at 768px to match the layout breakpoint. */
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
		form {
			flex-direction: column;
			align-items: stretch;
			gap: 0.5rem;
		}
		form :global(button) {
			width: 100%;
		}
		form label {
			width: 100%;
		}
	}
</style>
