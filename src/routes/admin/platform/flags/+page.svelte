<script lang="ts">
	import { enhance } from '$app/forms';
	import { Table, Card, Button, Badge, EmptyState, Kicker } from '$lib/components/ui';
	export let data;
	export let form;
	$: ({ flags, myOverrides, recentUsers } = data);

	// Per-row range slider reactive display.
	let rolloutDisplay: Record<string, number> = {};
	$: {
		for (const f of flags) {
			if (!(f.key in rolloutDisplay)) rolloutDisplay[f.key] = f.rolloutPercentage;
		}
	}

	const flagColumns = [
		{ key: 'key', label: 'Key' },
		{ key: 'description', label: 'Description' },
		{ key: 'enabled', label: 'Enabled' },
		{ key: 'rollout', label: 'Rollout %' },
		{ key: 'updated', label: 'Updated' },
		{ key: 'actions', label: 'Actions' }
	];

	const overrideColumns = [
		{ key: 'flag', label: 'Flag' },
		{ key: 'enabled', label: 'Enabled' },
		{ key: 'created', label: 'Created' },
		{ key: 'remove', label: 'Remove' }
	];
</script>

<svelte:head>
	<title>Feature flags — Platform admin</title>
</svelte:head>

<div class="page-header">
	<p class="back-link"><a href="/admin/platform">&larr; Overview</a></p>
	<Kicker>Platform admin</Kicker>
	<h2 class="page-title">Feature flags</h2>
	<p class="note">
		Toggle enable/disable and the rollout percentage per flag. Per-user overrides below win over the
		global flag and rollout decision. Every change is recorded in the audit log as <code
			>feature_flag.changed</code
		>.
	</p>
</div>

{#if form?.error}
	<p class="feedback feedback--err" role="alert">{form.error}</p>
{/if}
{#if form?.ok}
	<p class="feedback feedback--ok">Saved.</p>
{/if}

<section class="section">
	<h3 class="section-title">Flags</h3>
	<Table columns={flagColumns} rows={flags} caption="Feature flags" getKey={(r) => r.key}>
		{#snippet cell(row, col)}
			{#if col.key === 'key'}
				<code>{row.key}</code>
			{:else if col.key === 'description'}
				<input
					type="text"
					name="description"
					form="flag-{row.key}"
					value={row.description ?? ''}
					placeholder="(no description)"
					class="inline-input"
				/>
			{:else if col.key === 'enabled'}
				<select name="enabled" form="flag-{row.key}" class="inline-select">
					<option value="true" selected={row.enabled}>on</option>
					<option value="false" selected={!row.enabled}>off</option>
				</select>
			{:else if col.key === 'rollout'}
				<div class="rollout-cell">
					<input
						type="range"
						name="rollout_percentage"
						form="flag-{row.key}"
						min="0"
						max="100"
						value={rolloutDisplay[row.key] ?? row.rolloutPercentage}
						class="range-slider"
						oninput={(e) => {
							rolloutDisplay[row.key] = Number((e.target as HTMLInputElement).value);
							rolloutDisplay = { ...rolloutDisplay };
						}}
					/>
					<span class="pct">{rolloutDisplay[row.key] ?? row.rolloutPercentage}%</span>
				</div>
			{:else if col.key === 'updated'}
				<span class="timestamp">{new Date(row.updatedAt).toLocaleString()}</span>
			{:else if col.key === 'actions'}
				<!-- Form lives here; inputs above associate via their form attribute -->
				<form id="flag-{row.key}" method="POST" action="?/saveFlag" use:enhance>
					<input type="hidden" name="key" value={row.key} />
					<Button type="submit" size="sm">Save</Button>
				</form>
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title="No flags yet" description="Create one below." />
		{/snippet}
	</Table>
</section>

<section class="section">
	<h3 class="section-title">Add flag</h3>
	<Card>
		<form method="POST" action="?/createFlag" use:enhance class="form-row">
			<div class="field-group">
				<label class="field-label" for="new-key">Key</label>
				<input
					id="new-key"
					type="text"
					name="key"
					required
					pattern="[a-z][a-z0-9_.\-]{'{1,63}'}"
					placeholder="my.feature"
					class="inline-input"
				/>
			</div>
			<div class="field-group">
				<label class="field-label" for="new-description">Description</label>
				<input
					id="new-description"
					type="text"
					name="description"
					placeholder="optional"
					class="inline-input"
				/>
			</div>
			<div class="form-action">
				<Button type="submit">Create</Button>
			</div>
		</form>
		<p class="hint">
			Keys must start with a lowercase letter; allowed: <code>a-z 0-9 _ . -</code>.
		</p>
	</Card>
</section>

<section class="section">
	<h3 class="section-title">Per-user overrides</h3>
	<Card>
		<form method="POST" action="?/setOverride" use:enhance class="form-row">
			<div class="field-group">
				<label class="field-label" for="override-flag">Flag</label>
				<select id="override-flag" name="flag_key" required class="inline-select">
					{#each flags as f (f.key)}
						<option value={f.key}>{f.key}</option>
					{/each}
				</select>
			</div>
			<div class="field-group">
				<label class="field-label" for="override-user">User (username or uuid)</label>
				<input
					id="override-user"
					type="text"
					name="user_query"
					required
					list="recent-users"
					placeholder="search…"
					class="inline-input"
				/>
				<datalist id="recent-users">
					{#each recentUsers as u (u.id)}
						<option value={u.username}>{u.username}</option>
					{/each}
				</datalist>
			</div>
			<div class="field-group">
				<label class="field-label" for="override-enabled">Enabled</label>
				<select id="override-enabled" name="enabled" class="inline-select">
					<option value="true">on</option>
					<option value="false">off</option>
				</select>
			</div>
			<div class="form-action">
				<Button type="submit">Set override</Button>
			</div>
		</form>
	</Card>

	<h4 class="subsection-title">Your overrides</h4>
	<Table
		columns={overrideColumns}
		rows={myOverrides}
		caption="Your flag overrides"
		getKey={(r) => r.flagKey + ':' + r.userId}
	>
		{#snippet cell(row, col)}
			{#if col.key === 'flag'}
				<code>{row.flagKey}</code>
			{:else if col.key === 'enabled'}
				<Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? 'on' : 'off'}</Badge>
			{:else if col.key === 'created'}
				<span class="timestamp">{new Date(row.createdAt).toLocaleString()}</span>
			{:else if col.key === 'remove'}
				<form method="POST" action="?/removeOverride" use:enhance>
					<input type="hidden" name="flag_key" value={row.flagKey} />
					<input type="hidden" name="user_id" value={row.userId} />
					<Button type="submit" variant="danger" size="sm">Remove</Button>
				</form>
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title="No overrides set for you." />
		{/snippet}
	</Table>
</section>

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
		max-width: 70ch;
		margin: var(--space-2) 0 0;
	}

	.feedback {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
	}

	.feedback--err {
		color: var(--color-danger);
		background: var(--color-surface-alt);
		border-left: var(--border-2) solid var(--color-danger);
	}

	.feedback--ok {
		color: var(--color-accent);
		background: var(--color-surface-alt);
		border-left: var(--border-2) solid var(--color-accent);
	}

	.section {
		margin-top: var(--space-7);
	}

	.section-title {
		font-family: var(--font-ui);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 var(--space-4);
	}

	.subsection-title {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--color-text);
		margin: var(--space-5) 0 var(--space-3);
	}

	.inline-input {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		width: 100%;
		max-width: 20rem;
	}

	.inline-select {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
	}

	.rollout-cell {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.range-slider {
		flex: 1;
		min-width: 6rem;
	}

	.pct {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		min-width: 2.5rem;
		text-align: right;
	}

	.timestamp {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.form-row {
		display: flex;
		gap: var(--space-4);
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.form-action {
		align-self: flex-end;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.hint {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin: var(--space-3) 0 0;
	}
</style>
