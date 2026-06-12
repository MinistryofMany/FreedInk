<script lang="ts">
	import { goto } from '$app/navigation';
	import { _ } from '$lib/i18n';

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

<h3>{$_('admin.create_blog_heading')}</h3>

<form on:submit|preventDefault={createBlog}>
	<label for="title">{$_('admin.title_label')}</label>
	<input type="text" id="title" name="title" bind:value={title} required />

	<label for="description">{$_('admin.description_label')}</label>
	<textarea id="description" name="description" bind:value={description} required rows="5"
	></textarea>

	{#if error}<p style="color: var(--color-red)">{error}</p>{/if}
	<button type="submit" disabled={busy}
		>{busy ? $_('admin.creating') : $_('admin.create_button')}</button
	>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 80ch;
	}
</style>
