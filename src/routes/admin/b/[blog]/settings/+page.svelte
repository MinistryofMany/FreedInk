<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { POST_LANGUAGES } from '$lib/languages';
	export let data;

	let title = data.blog.title;
	let description = data.blog.description;
	let approvalNumerator = data.blog.approvalNumerator;
	let approvalDenominator = data.blog.approvalDenominator;
	let defaultLanguage = data.blog.defaultLanguage ?? 'en';
	let busy = false;
	let msg = '';
	let isError = false;

	$: validThreshold =
		Number.isInteger(approvalNumerator) &&
		Number.isInteger(approvalDenominator) &&
		approvalNumerator >= 1 &&
		approvalDenominator >= 1 &&
		approvalDenominator <= 100 &&
		approvalNumerator <= approvalDenominator;

	// Preview text: "Posts publish when X of Y eligible reviewers approve" —
	// computed only when the inputs are valid so we don't show nonsense
	// numbers while the author is typing.
	$: previewText = validThreshold
		? `Posts publish when ${approvalNumerator} of every ${approvalDenominator} eligible reviewers approve.`
		: 'Set a valid ratio (1 ≤ numerator ≤ denominator ≤ 100).';

	async function save() {
		if (!validThreshold) return;
		busy = true;
		msg = '';
		isError = false;
		const titleChanged = title.trim() !== data.blog.title;
		const body: Record<string, unknown> = {
			blog_id: data.blog.id,
			approval_numerator: approvalNumerator,
			approval_denominator: approvalDenominator,
			description: description.trim().length === 0 ? null : description,
			default_language: defaultLanguage
		};
		if (titleChanged) body.title = title.trim();
		const res = await fetch('/api/blog/settings', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		busy = false;
		if (!res.ok) {
			isError = true;
			msg = await res.text();
			return;
		}
		const json = await res.json();
		msg = 'Settings saved.';
		// Title-change moves the blog to a new slug; redirect there so the
		// admin URLs still resolve.
		if (json.blog.slug !== data.blog.slug) {
			await goto(`/admin/b/${json.blog.slug}/settings`);
		} else {
			await invalidateAll();
		}
	}
</script>

<h3>Settings — {data.blog.title}</h3>

<form on:submit|preventDefault={save}>
	<div class="field">
		<label for="blog-title">Title</label>
		<input id="blog-title" type="text" bind:value={title} required maxlength="300" />
		<small>Changing the title updates the blog's URL slug.</small>
	</div>

	<div class="field">
		<label for="blog-description">Description</label>
		<textarea id="blog-description" bind:value={description} maxlength="2000" rows="3"></textarea>
	</div>

	<div class="field">
		<label for="blog-language">Default post language</label>
		<select id="blog-language" bind:value={defaultLanguage}>
			{#each POST_LANGUAGES as l}
				<option value={l.code}>{l.name}</option>
			{/each}
		</select>
		<small>Used as the default when a writer creates a new post. Each post can override it.</small>
	</div>

	<fieldset>
		<legend>Approval threshold</legend>
		<div class="threshold">
			<label>
				Numerator
				<input
					type="number"
					min="1"
					max="100"
					step="1"
					bind:value={approvalNumerator}
					required
				/>
			</label>
			<span class="slash">/</span>
			<label>
				Denominator
				<input
					type="number"
					min="1"
					max="100"
					step="1"
					bind:value={approvalDenominator}
					required
				/>
			</label>
		</div>
		<p class="preview" class:invalid={!validThreshold}>{previewText}</p>
	</fieldset>

	{#if msg}
		<p style:color={isError ? 'var(--color-red)' : 'var(--color-green-dark)'}>{msg}</p>
	{/if}

	<button type="submit" disabled={busy || !validThreshold} style="max-width: 20ch">
		{busy ? 'Saving…' : 'Save settings'}
	</button>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.field input,
	.field textarea {
		width: 100%;
	}
	fieldset {
		border: 1px solid var(--color-green-light);
		padding: 1rem;
		border-radius: 4px;
	}
	.threshold {
		display: flex;
		align-items: end;
		gap: 0.5rem;
	}
	.threshold input {
		width: 6rem;
	}
	.slash {
		font-size: 1.5rem;
		padding-bottom: 0.25rem;
	}
	.preview {
		margin: 0.5rem 0 0;
		color: var(--color-green-dark);
		font-size: 0.9rem;
	}
	.preview.invalid {
		color: var(--color-red);
	}
</style>
