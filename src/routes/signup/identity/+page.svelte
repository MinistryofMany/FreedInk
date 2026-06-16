<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { generateIdentity, encodeForWire, cacheUnlockedIdentity } from '$lib/client/vault';
	import { _ } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { Card, Field, Button, Kicker } from '$lib/components/ui';

	export let data;

	// Carried through from the Minister callback when the user arrived mid-flow
	// (e.g. accepting an invitation). Only same-origin paths are produced upstream.
	function safeNext(raw: string | null): string {
		if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
		return '/admin';
	}
	let password = '';
	let confirm = '';
	// Pre-filled from anything Minister disclosed at sign-in; otherwise blank.
	// Optional — left empty, the auto-generated username is used everywhere.
	let displayName = data.displayName ?? '';
	let busy = false;
	let error = '';

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		void create();
	}

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
			// Persist the chosen display name (best effort — the account is already
			// usable without one, so a failure here shouldn't block the flow). Only
			// send it when it differs from what's already stored.
			const trimmed = displayName.trim();
			if (trimmed !== (data.displayName ?? '')) {
				const profileRes = await fetch('/api/user', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ displayName: trimmed === '' ? null : trimmed })
				});
				if (!profileRes.ok) {
					error = await profileRes.text();
					return;
				}
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

<div class="page-wrap">
	<Card padding="lg" elevated>
		<div class="stack">
			<Kicker>Identity setup</Kicker>
			<h1 class="heading">{$_('identity.set_password_heading')}</h1>
			<p class="body-text">
				{$_('identity.intro', { values: { username: data.username } })}
				<strong>{$_('identity.cannot_recover')}</strong>
				{$_('identity.forgot_warning')}
			</p>

			{#if data.hasIdentity}
				<div class="banner banner--danger">
					<p>{$_('identity.already_have')}</p>
				</div>
				<Button href="/settings" variant="ghost">{$_('identity.go_to_settings')}</Button>
			{:else}
				<form onsubmit={handleSubmit} class="form">
					<Field
						label={$_('identity.display_name_label')}
						bind:value={displayName}
						placeholder={$_('identity.display_name_placeholder')}
						help={$_('identity.display_name_hint')}
						maxlength={80}
						autocomplete="nickname"
					/>

					<div class="field">
						<label for="password" class="field-label"
							>{$_('identity.password_label')}<span class="required" aria-hidden="true">
								*</span
							></label
						>
						<input
							id="password"
							type="password"
							bind:value={password}
							required
							minlength="12"
							autocomplete="new-password"
							aria-required="true"
						/>
					</div>

					<div class="field">
						<label for="confirm" class="field-label"
							>{$_('identity.confirm_label')}<span class="required" aria-hidden="true">
								*</span
							></label
						>
						<input
							id="confirm"
							type="password"
							bind:value={confirm}
							required
							minlength="12"
							autocomplete="new-password"
							aria-required="true"
						/>
					</div>

					{#if error}
						<p class="error" role="alert">{error}</p>
					{/if}

					<Button type="submit" variant="primary" loading={busy}>
						{busy ? $_('identity.generating') : $_('identity.create_button')}
					</Button>
				</form>
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

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Native labeled inputs matching Field's visual pattern */
	.field {
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

	.required {
		color: var(--color-danger);
	}

	.banner {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-surface-alt);
	}

	.banner p {
		margin: 0;
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
