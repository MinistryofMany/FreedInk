<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { generateIdentity, encodeForWire, cacheUnlockedIdentity } from '$lib/client/vault';
	import { _ } from '$lib/i18n';
	import { get } from 'svelte/store';

	export let data;

	// Carried through from the Minister callback when the user arrived mid-flow
	// (e.g. accepting an invitation). Only same-origin paths are produced upstream.
	function safeNext(raw: string | null): string {
		if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
		return '/admin';
	}
	let password = '';
	let confirm = '';
	let busy = false;
	let error = '';

	async function create() {
		const t = get(_);
		if (password.length < 12) {
			error = t('identity.error_min_length');
			return;
		}
		if (password !== confirm) {
			error = t('identity.error_mismatch');
			return;
		}
		busy = true;
		error = '';
		try {
			const { identity, record } = await generateIdentity(password);
			const res = await fetch('/api/identity', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(encodeForWire(record))
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			cacheUnlockedIdentity(identity);
			goto(safeNext($page.url.searchParams.get('next')));
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<section>
	<h2>{$_('identity.set_password_heading')}</h2>
	<p>
		{$_('identity.intro', { values: { username: data.username } })}
		<strong>{$_('identity.cannot_recover')}</strong>
		{$_('identity.forgot_warning')}
	</p>
	{#if data.hasIdentity}
		<p style="color: var(--color-red)">{$_('identity.already_have')}</p>
		<a href="/settings" class="btn">{$_('identity.go_to_settings')}</a>
	{:else}
		<form on:submit|preventDefault={create}>
			<label>
				{$_('identity.password_label')}
				<input
					type="password"
					bind:value={password}
					required
					minlength="12"
					autocomplete="new-password"
				/>
			</label>
			<label>
				{$_('identity.confirm_label')}
				<input
					type="password"
					bind:value={confirm}
					required
					minlength="12"
					autocomplete="new-password"
				/>
			</label>
			{#if error}<p style="color: var(--color-red)">{error}</p>{/if}
			<button type="submit" disabled={busy}>
				{busy ? $_('identity.generating') : $_('identity.create_button')}
			</button>
		</form>
	{/if}
</section>

<style>
	section {
		max-width: 36rem;
		margin: 3rem auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
