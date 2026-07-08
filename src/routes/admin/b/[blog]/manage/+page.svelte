<script lang="ts">
	import { Table, Card, Field, Button, Badge, AlertDialog, Kicker } from '$lib/components/ui';

	export let data;
	let members = data.members;
	let blog = data.blog;

	const ROLES = ['owner', 'editor', 'reviewer', 'author', 'commenter'] as const;
	type Role = (typeof ROLES)[number];

	let addUsername = '';
	let addRole: Role = 'author';
	let busy = false;
	let msg = '';
	let msgIsError = false;

	// ── Invitations (Wave: invitations) ─────────────────────────────
	let invitations = data.invitations;
	let inviteEmail = '';
	let inviteRole: Role = 'author';
	let inviteBusy = false;
	let inviteMsg = '';
	let inviteMsgIsError = false;

	// AlertDialog state: which member's remove dialog is open
	// AlertDialog state: which invitation's revoke dialog is open

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
		inviteMsgIsError = false;
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
				inviteMsgIsError = true;
			}
		} finally {
			inviteBusy = false;
		}
	}

	async function revokeInvite(id: string) {
		inviteBusy = true;
		inviteMsg = '';
		inviteMsgIsError = false;
		try {
			const res = await fetch(`/api/blog/invite/${id}`, { method: 'DELETE' });
			if (res.ok) {
				await refreshInvitations();
			} else {
				inviteMsg = await res.text();
				inviteMsgIsError = true;
			}
		} finally {
			inviteBusy = false;
		}
	}

	async function setRole(target: { user_id?: string; username?: string }, role: Role) {
		busy = true;
		msg = '';
		msgIsError = false;
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
					// Derive caps from the role for the optimistic row (same mapping
					// the server's capabilitiesForRole uses). The next load reflects
					// the authoritative columns.
					caps: capsForRole(json.member.role),
					addedAt: new Date()
				}
			];
		} else {
			msg = await res.text();
			msgIsError = true;
		}
	}

	function onRoleChange(user_id: string, ev: Event) {
		const target = ev.currentTarget as HTMLSelectElement;
		setRole({ user_id }, target.value as Role);
	}

	type Capability = 'author' | 'review' | 'comment' | 'admin';

	// Client mirror of the server's capabilitiesForRole, for optimistic UI only.
	function capsForRole(role: Role): {
		author: boolean;
		review: boolean;
		comment: boolean;
		admin: boolean;
	} {
		return {
			author: role === 'owner' || role === 'editor' || role === 'author',
			review: role === 'owner' || role === 'editor' || role === 'reviewer',
			comment: true,
			admin: role === 'owner'
		};
	}
	const CAPABILITIES: Capability[] = ['author', 'review', 'comment', 'admin'];

	// Toggle one capability on a member via the can_admin-gated PATCH. On success
	// we sync the row's caps from the response (the server may re-derive the
	// role label too). On failure (e.g. last-admin guard) we surface the error and
	// leave the checkbox state to be reset by the reactive bind.
	async function toggleCapability(
		member: (typeof members)[number],
		cap: Capability,
		value: boolean
	) {
		busy = true;
		msg = '';
		msgIsError = false;
		const res = await fetch('/api/blog/members', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				blog_id: blog.id,
				target: { username: member.username },
				caps: { [cap]: value }
			})
		});
		busy = false;
		if (res.ok) {
			const json = await res.json();
			members = members.map((m) => (m.user_id === member.user_id ? { ...m, caps: json.caps } : m));
		} else {
			msg = await res.text();
			msgIsError = true;
			// Force a re-render so the checkbox reverts to the unchanged caps.
			members = [...members];
		}
	}

	function onCapToggle(member: (typeof members)[number], cap: Capability, ev: Event) {
		const target = ev.currentTarget as HTMLInputElement;
		toggleCapability(member, cap, target.checked);
	}

	// Render a permission-change entry as a +/- capability diff string.
	function diffCaps(oldCaps: Record<string, boolean>, newCaps: Record<string, boolean>): string {
		const parts: string[] = [];
		for (const cap of CAPABILITIES) {
			if (oldCaps[cap] !== newCaps[cap]) parts.push((newCaps[cap] ? '+' : '−') + cap);
		}
		return parts.join(', ') || 'no change';
	}

	async function remove(user_id: string) {
		busy = true;
		msgIsError = false;
		const res = await fetch('/api/blog/members', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ blog_id: blog.id, target_user_id: user_id })
		});
		busy = false;
		if (res.ok) members = members.filter((m) => m.user_id !== user_id);
		else {
			msg = await res.text();
			msgIsError = true;
		}
	}

	async function addUser() {
		if (!addUsername) return;
		await setRole({ username: addUsername }, addRole);
		addUsername = '';
	}

	const memberColumns = [
		{ key: 'username', label: 'Username' },
		{ key: 'role', label: 'Role' },
		{ key: 'change', label: 'Change to' },
		{ key: 'remove', label: '' }
	];

	const pendingColumns = [
		{ key: 'email', label: 'Email' },
		{ key: 'role', label: 'Role' },
		{ key: 'expires', label: 'Expires' },
		{ key: 'revoke', label: '' }
	];

	const decisionColumns = [
		{ key: 'email', label: 'Email' },
		{ key: 'role', label: 'Role' },
		{ key: 'status', label: 'Status' },
		{ key: 'when', label: 'When' }
	];
</script>

<svelte:head>
	<title>Manage — {blog.title}</title>
</svelte:head>

<header class="page-header">
	<div class="header-row">
		<h3 class="page-title">{blog.title}</h3>
		<Button href="/admin/b/{blog.slug}/author">Write a post</Button>
	</div>
</header>

<!-- Status live region for member actions -->
{#if msg}
	<p class="status-msg" class:status-error={msgIsError} role="status" aria-live="polite">
		{msg}
	</p>
{:else}
	<p class="status-msg" role="status" aria-live="polite"></p>
{/if}

<!-- Members table -->
<section class="section">
	<Kicker>Members</Kicker>

	<Table
		columns={memberColumns}
		rows={members}
		caption="Blog members"
		getKey={(row) => row.user_id}
	>
		{#snippet cell(row, col)}
			{#if col.key === 'username'}
				{row.username}
			{:else if col.key === 'role'}
				{row.role}
			{:else if col.key === 'change'}
				<select
					value={row.role}
					on:change={(e) => onRoleChange(row.user_id, e)}
					disabled={busy}
					aria-label="Change role for {row.username}"
					class="role-select"
				>
					{#each ROLES as r}
						<option value={r}>{r}</option>
					{/each}
				</select>
			{:else if col.key === 'remove'}
				<AlertDialog
					title="Remove member"
					description="Remove {row.username} from {blog.title}? They will lose access immediately."
					confirmLabel="Remove"
					tone="danger"
					onConfirm={() => remove(row.user_id)}
				>
					{#snippet trigger(props)}
						<Button variant="danger" size="sm" disabled={busy} {...props}>Remove</Button>
					{/snippet}
				</AlertDialog>
			{/if}
		{/snippet}
	</Table>

	<div class="subsection">
		<h4 class="subsection-title">Add a member</h4>
		<Card padding="md">
			<form on:submit|preventDefault={addUser} class="add-form">
				<Field label="Username" bind:value={addUsername} required minlength={3} />
				<div class="field-col">
					<label class="select-label" for="add-role">Role</label>
					<select id="add-role" bind:value={addRole} class="role-select">
						{#each ROLES as r}
							<option value={r}>{r}</option>
						{/each}
					</select>
				</div>
				<div class="form-action">
					<Button type="submit" disabled={busy}>Add</Button>
				</div>
			</form>
		</Card>
	</div>
</section>

<!-- Permissions grid (capability checkboxes). can_admin-gated; the last admin
     can't be demoted (server-enforced). A member can't toggle their own caps. -->
<section class="section">
	<Kicker>Permissions</Kicker>
	<details class="advanced">
		<summary>Advanced: per-capability permissions</summary>
		<p class="section-note">
			A role (above) is a preset for these capabilities. Use this grid only to diverge from a
			preset — grant or revoke a single capability without changing the role. Authors write posts;
			reviewers cast publish votes; commenters comment; admins manage the blog. Changes are recorded
			and shown to all members below.
		</p>
		<div class="perm-grid" role="table" aria-label="Member permissions">
		<div class="perm-row perm-head" role="row">
			<span role="columnheader">Member</span>
			{#each CAPABILITIES as cap}
				<span role="columnheader" class="perm-cap">{cap}</span>
			{/each}
		</div>
		{#each members as member (member.user_id)}
			<div class="perm-row" role="row">
				<span class="perm-name">{member.displayName?.trim() || member.username}</span>
				{#each CAPABILITIES as cap}
					<span class="perm-cell">
						<input
							type="checkbox"
							checked={member.caps[cap]}
							disabled={busy || member.user_id === data.currentUserId}
							on:change={(e) => onCapToggle(member, cap, e)}
							aria-label="{cap} for {member.username}"
						/>
					</span>
				{/each}
			</div>
		{/each}
	</div>
	</details>
</section>

<!-- Member-visible attributed permission change log (never IP/UA). -->
<section class="section">
	<Kicker>Permission changes</Kicker>
	{#if data.permissionChanges.length === 0}
		<p class="section-note">No permission changes yet.</p>
	{:else}
		<ul class="change-log" role="list">
			{#each data.permissionChanges as change (change.id)}
				<li class="change-item">
					<span class="change-text">
						<strong>{change.actor ?? 'A former member'}</strong>
						changed
						<strong>{change.subject ?? 'a former member'}</strong>'s permissions:
						{diffCaps(change.oldCaps, change.newCaps)}
					</span>
					<span class="change-date">{new Date(change.createdAt).toLocaleString()}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- Invitations section -->
<section class="section">
	<Kicker>Invitations</Kicker>

	{#if inviteMsg}
		<p class="status-msg" class:status-error={inviteMsgIsError} role="status" aria-live="polite">
			{inviteMsg}
		</p>
	{/if}

	<Card padding="md">
		<h4 class="subsection-title">Send an invitation</h4>
		<form on:submit|preventDefault={sendInvite} class="add-form">
			<Field label="Email" type="email" bind:value={inviteEmail} required autocomplete="off" />
			<div class="field-col">
				<label class="select-label" for="invite-role">Role</label>
				<select id="invite-role" bind:value={inviteRole} class="role-select">
					{#each ROLES as r}
						<option value={r}>{r}</option>
					{/each}
				</select>
			</div>
			<div class="form-action">
				<Button type="submit" disabled={inviteBusy}>Send invite</Button>
			</div>
		</form>
	</Card>

	<div class="subsection">
		<h4 class="subsection-title">Pending</h4>
		{#if pendingInvitations.length === 0}
			<p class="empty">No pending invitations.</p>
		{:else}
			<Table
				columns={pendingColumns}
				rows={pendingInvitations}
				caption="Pending invitations"
				getKey={(row) => row.id}
			>
				{#snippet cell(row, col)}
					{#if col.key === 'email'}
						{row.email}
					{:else if col.key === 'role'}
						{row.role}
					{:else if col.key === 'expires'}
						{new Date(row.expiresAt).toLocaleString()}
					{:else if col.key === 'revoke'}
						<AlertDialog
							title="Revoke invitation"
							description="Revoke the invitation sent to {row.email}? The link will stop working immediately."
							confirmLabel="Revoke"
							tone="danger"
							onConfirm={() => revokeInvite(row.id)}
						>
							{#snippet trigger(props)}
								<Button variant="danger" size="sm" disabled={inviteBusy} {...props}>Revoke</Button>
							{/snippet}
						</AlertDialog>
					{/if}
				{/snippet}
			</Table>
		{/if}
	</div>

	{#if recentDecisions.length > 0}
		<div class="subsection">
			<h4 class="subsection-title">Recent</h4>
			<Table
				columns={decisionColumns}
				rows={recentDecisions}
				caption="Recent invitation decisions"
				getKey={(row) => row.id}
			>
				{#snippet cell(row, col)}
					{#if col.key === 'email'}
						{row.email}
					{:else if col.key === 'role'}
						{row.role}
					{:else if col.key === 'status'}
						{#if row.acceptedAt}
							<Badge tone="success">
								Accepted{row.acceptedByUsername ? ` by ${row.acceptedByUsername}` : ''}
							</Badge>
						{:else if row.revokedAt}
							<Badge tone="neutral">Revoked</Badge>
						{/if}
					{:else if col.key === 'when'}
						{new Date(row.acceptedAt ?? row.revokedAt ?? row.createdAt).toLocaleString()}
					{/if}
				{/snippet}
			</Table>
		</div>
	{/if}
</section>

<style>
	.section-note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		max-width: 64ch;
		margin: 0 0 var(--space-3);
	}

	.advanced > summary {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
		cursor: pointer;
		padding: var(--space-2) 0;
	}

	.perm-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
	}

	.perm-row {
		display: grid;
		grid-template-columns: minmax(8rem, 1fr) repeat(4, 4rem);
		align-items: center;
		gap: var(--space-2);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--color-border);
	}

	.perm-head {
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.perm-cap {
		text-transform: capitalize;
		text-align: center;
	}

	.perm-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.perm-cell {
		text-align: center;
	}

	.change-log {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
	}

	.change-item {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--color-border);
	}

	.change-date {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		white-space: nowrap;
	}

	.page-header {
		margin-bottom: var(--space-5);
	}

	.header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.page-title {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}

	.status-msg {
		min-height: 1.4em;
		font-size: var(--text-sm);
		color: var(--color-accent);
		margin: 0 0 var(--space-4);
	}

	.status-msg.status-error {
		color: var(--color-danger);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-bottom: var(--space-8);
	}

	.subsection {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.subsection-title {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	.add-form {
		display: flex;
		flex-direction: row;
		gap: var(--space-4);
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.field-col {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.select-label {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.role-select {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0 var(--space-3);
		min-height: var(--touch-target);
		cursor: pointer;
	}

	.role-select:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.form-action {
		padding-bottom: 0;
	}

	.empty {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	@media (max-width: 767px) {
		.header-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.add-form {
			flex-direction: column;
			align-items: stretch;
		}

		.form-action :global(.btn) {
			width: 100%;
		}
	}
</style>
