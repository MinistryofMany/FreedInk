<script lang="ts">
	import { enhance } from '$app/forms';
	export let data;
	export let form;
	$: ({ flags, myOverrides, recentUsers } = data);
</script>

<svelte:head>
	<title>Feature flags — Platform admin</title>
</svelte:head>

<header>
	<p><a href="/admin/platform">&larr; Overview</a></p>
	<h2>Feature flags</h2>
	<p class="note">
		Toggle enable/disable and the rollout percentage per flag. Per-user overrides below win over the
		global flag and rollout decision. Every change is recorded in the audit log as <code
			>feature_flag.changed</code
		>.
	</p>
</header>

{#if form?.error}
	<p class="err">{form.error}</p>
{/if}
{#if form?.ok}
	<p class="ok">Saved.</p>
{/if}

<section>
	<h3>Flags</h3>
	{#if flags.length === 0}
		<p>No flags yet — create one below.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Key</th>
					<th>Description</th>
					<th>Enabled</th>
					<th>Rollout %</th>
					<th>Updated</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each flags as f (f.key)}
					<tr>
						<form method="POST" action="?/saveFlag" use:enhance>
							<td><code>{f.key}</code><input type="hidden" name="key" value={f.key} /></td>
							<td>
								<input
									type="text"
									name="description"
									value={f.description ?? ''}
									placeholder="(no description)"
								/>
							</td>
							<td>
								<select name="enabled">
									<option value="true" selected={f.enabled}>on</option>
									<option value="false" selected={!f.enabled}>off</option>
								</select>
							</td>
							<td>
								<input
									type="range"
									name="rollout_percentage"
									min="0"
									max="100"
									value={f.rolloutPercentage}
								/>
								<span class="pct">{f.rolloutPercentage}%</span>
							</td>
							<td><small>{new Date(f.updatedAt).toLocaleString()}</small></td>
							<td><button type="submit">Save</button></td>
						</form>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section>
	<h3>Add flag</h3>
	<form method="POST" action="?/createFlag" use:enhance class="row-form">
		<label>
			Key
			<input
				type="text"
				name="key"
				required
				pattern="[a-z][a-z0-9_.\-]{'{1,63}'}"
				placeholder="my.feature"
			/>
		</label>
		<label>
			Description
			<input type="text" name="description" placeholder="optional" />
		</label>
		<button type="submit">Create</button>
	</form>
	<p class="hint">
		Keys must start with a lowercase letter; allowed: <code>a-z 0-9 _ . -</code>.
	</p>
</section>

<section>
	<h3>Per-user overrides</h3>
	<form method="POST" action="?/setOverride" use:enhance class="row-form">
		<label>
			Flag
			<select name="flag_key" required>
				{#each flags as f (f.key)}
					<option value={f.key}>{f.key}</option>
				{/each}
			</select>
		</label>
		<label>
			User (username or uuid)
			<input type="text" name="user_query" required list="recent-users" placeholder="search…" />
			<datalist id="recent-users">
				{#each recentUsers as u (u.id)}
					<option value={u.username}>{u.username}</option>
				{/each}
			</datalist>
		</label>
		<label>
			Enabled
			<select name="enabled">
				<option value="true">on</option>
				<option value="false">off</option>
			</select>
		</label>
		<button type="submit">Set override</button>
	</form>

	<h4>Your overrides</h4>
	{#if myOverrides.length === 0}
		<p>No overrides set for you.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Flag</th>
					<th>Enabled</th>
					<th>Created</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each myOverrides as o (o.flagKey + ':' + o.userId)}
					<tr>
						<td><code>{o.flagKey}</code></td>
						<td>{o.enabled ? 'on' : 'off'}</td>
						<td><small>{new Date(o.createdAt).toLocaleString()}</small></td>
						<td>
							<form method="POST" action="?/removeOverride" use:enhance>
								<input type="hidden" name="flag_key" value={o.flagKey} />
								<input type="hidden" name="user_id" value={o.userId} />
								<button type="submit">Remove</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	header {
		margin-bottom: 1.5rem;
	}
	.note {
		font-size: 0.85rem;
		color: #666;
		max-width: 70ch;
	}
	.err {
		color: #b00;
	}
	.ok {
		color: #060;
	}
	section {
		margin-top: 2rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		border-bottom: 1px solid #eee;
		padding: 0.4rem;
		vertical-align: middle;
		text-align: left;
	}
	input[type='text'] {
		width: 100%;
		max-width: 28rem;
	}
	.pct {
		display: inline-block;
		min-width: 2.5rem;
		text-align: right;
	}
	.row-form {
		display: flex;
		gap: 0.75rem;
		align-items: flex-end;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.row-form label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
	}
	.hint {
		font-size: 0.8rem;
		color: #666;
	}
</style>
