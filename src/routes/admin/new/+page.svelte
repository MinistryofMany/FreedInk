<script lang="ts">
	import { goto } from '$app/navigation';
	import { _ } from '$lib/i18n';
	import { Card, Field, Button } from '$lib/components/ui';

	let title = '';
	let description = '';
	let busy = false;
	let error = '';

	async function createBlog() {
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/blog/create', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title, description })
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			const json = await res.json();
			goto(`/admin/b/${json.slug}/manage`);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<Card>
	<h3 class="page-heading">{$_('admin.create_blog_heading')}</h3>

	<form on:submit|preventDefault={createBlog}>
		<Field label={$_('admin.title_label')} bind:value={title} required />

		<Field
			label={$_('admin.description_label')}
			multiline
			rows={5}
			bind:value={description}
			required
		/>

		{#if error}
			<p class="error-msg">{error}</p>
		{/if}

		<div class="form-actions">
			<Button type="submit" disabled={busy} loading={busy}>
				{busy ? $_('admin.creating') : $_('admin.create_button')}
			</Button>
		</div>
	</form>
</Card>

<style>
	.page-heading {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		margin: 0 0 var(--space-4);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 80ch;
	}

	.error-msg {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-danger);
	}

	.form-actions {
		display: flex;
	}
</style>
