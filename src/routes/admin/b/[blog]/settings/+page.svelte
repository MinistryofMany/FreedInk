<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { POST_LANGUAGES } from '$lib/languages';
	import { Card, Field, Button, Kicker } from '$lib/components/ui';
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

<Card>
	<h3 class="page-heading">Settings — {data.blog.title}</h3>

	<form on:submit|preventDefault={save}>
		<Field
			label="Title"
			bind:value={title}
			required
			maxlength={300}
			help="Changing the title updates the blog's URL slug."
		/>

		<Field label="Description" multiline bind:value={description} maxlength={2000} rows={3} />

		<div class="field-native">
			<label class="native-label" for="blog-language">Default post language</label>
			<select id="blog-language" class="native-select" bind:value={defaultLanguage}>
				{#each POST_LANGUAGES as l}
					<option value={l.code}>{l.name}</option>
				{/each}
			</select>
			<p class="native-help">
				Used as the default when a writer creates a new post. Each post can override it.
			</p>
		</div>

		<div class="threshold-section">
			<Kicker>Approval threshold</Kicker>
			<div class="threshold-row">
				<div class="threshold-input">
					<label class="native-label" for="approval-numerator">Numerator</label>
					<input
						id="approval-numerator"
						class="number-input"
						type="number"
						min="1"
						max="100"
						step="1"
						bind:value={approvalNumerator}
						required
					/>
				</div>
				<span class="slash" aria-hidden="true">/</span>
				<div class="threshold-input">
					<label class="native-label" for="approval-denominator">Denominator</label>
					<input
						id="approval-denominator"
						class="number-input"
						type="number"
						min="1"
						max="100"
						step="1"
						bind:value={approvalDenominator}
						required
					/>
				</div>
			</div>
			<p class="preview" class:preview-invalid={!validThreshold}>{previewText}</p>
		</div>

		{#if msg}
			<p class="status-msg" class:status-error={isError}>{msg}</p>
		{/if}

		<div class="form-actions">
			<Button type="submit" disabled={busy || !validThreshold} loading={busy}>
				{busy ? 'Saving…' : 'Save settings'}
			</Button>
		</div>
	</form>
</Card>

<style>
	.page-heading {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text);
		margin: 0 0 var(--space-5);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 80ch;
	}

	/* Native select styled to match the design system */
	.field-native {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.native-label {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.native-select {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		max-width: 32ch;
	}

	.native-help {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	/* Approval threshold */
	.threshold-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.threshold-row {
		display: flex;
		align-items: flex-end;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.threshold-input {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.number-input {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		width: 7rem;
	}

	.slash {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		color: var(--color-text-muted);
		padding-bottom: var(--space-1);
	}

	.preview {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.preview-invalid {
		color: var(--color-danger);
	}

	/* Status message */
	.status-msg {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.status-error {
		color: var(--color-danger);
	}

	.form-actions {
		display: flex;
	}
</style>
