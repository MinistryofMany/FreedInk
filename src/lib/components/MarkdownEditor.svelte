<script lang="ts">
	// MarkdownEditor — Tiptap-based WYSIWYG editor that stores markdown.
	//
	// Why store markdown? Existing posts in the DB are markdown strings rendered
	// server-side via `renderMarkdown` (marked + DOMPurify). We keep that
	// invariant by serialising the editor's ProseMirror doc back to markdown on
	// every change. New WYSIWYG posts therefore render identically to
	// hand-authored markdown.
	//
	// SSR-safe: Tiptap touches `window` (it constructs an EditorView in the DOM)
	// so we only `new Editor(...)` inside onMount. The textarea fallback you'd
	// expect for SSR isn't necessary because the parent forms only mount under
	// authenticated client navigations, but we still guard via `onMount` to
	// avoid hydration warnings.
	//
	// Image uploads: drag-and-drop, paste, and a toolbar button all POST to
	// `/api/media/upload` (multipart). On success we insert an `image` node
	// whose `src` is the returned URL — the markdown serializer then emits
	// `![alt](/uploads/...)` automatically.

	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import type { Editor } from '@tiptap/core';

	export let value: string = '';
	export let placeholder: string = 'Write your post in markdown — or just type.';
	export let onChange: ((md: string) => void) | undefined = undefined;

	const dispatch = createEventDispatcher<{ change: string }>();

	let editorEl: HTMLDivElement;
	let fileInput: HTMLInputElement;
	let editor: Editor | null = null;
	let ready = false;
	let uploadError = '';
	let uploading = false;

	// Track the markdown value we last emitted so we can ignore the echo when
	// the parent re-assigns `value` (bind:value triggers a reactive update on
	// every parent change). Without this we'd loop: editor -> parent -> editor.
	let lastEmitted = '';

	async function init() {
		const [coreMod, starterKitMod, imageMod, linkMod, typographyMod, markdownMod] =
			await Promise.all([
				import('@tiptap/core'),
				import('@tiptap/starter-kit'),
				import('@tiptap/extension-image'),
				import('@tiptap/extension-link'),
				import('@tiptap/extension-typography'),
				import('tiptap-markdown')
			]);
		const { Editor } = coreMod;
		// Each Tiptap extension is exported under multiple names depending on
		// the package version (named export, default export, both). Coerce.
		const StarterKit =
			starterKitMod.default ?? (starterKitMod as unknown as { StarterKit: unknown }).StarterKit;
		const Image = imageMod.Image ?? imageMod.default;
		const Link = linkMod.Link ?? linkMod.default;
		const Typography = typographyMod.Typography ?? typographyMod.default;
		// tiptap-markdown only exports `Markdown` (no default).
		const Markdown = markdownMod.Markdown;

		editor = new Editor({
			element: editorEl,
			extensions: [
				StarterKit.configure({
					// We want code blocks but the StarterKit defaults are fine.
					// Disable the link mark in StarterKit so we can configure our own.
					link: false
				}),
				Link.configure({
					openOnClick: false,
					autolink: true,
					HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
				}),
				Image.configure({
					inline: false,
					allowBase64: false,
					HTMLAttributes: { loading: 'lazy' }
				}),
				Typography,
				Markdown.configure({
					// We treat the editor strictly as a markdown source. Disallow
					// raw HTML so a pasted `<script>` etc. can't sneak in.
					html: false,
					tightLists: true,
					linkify: true,
					breaks: false,
					transformPastedText: true,
					transformCopiedText: true
				})
			],
			content: value || '',
			editorProps: {
				attributes: {
					class: 'tiptap-content',
					'data-placeholder': placeholder
				},
				// Drop handler: intercept image files before ProseMirror tries to
				// embed them as data URLs / native drops.
				handleDrop: (view, event) => {
					const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
						f.type.startsWith('image/')
					);
					if (files.length === 0) return false;
					event.preventDefault();
					const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
					const pos = coords?.pos ?? view.state.selection.from;
					void uploadAndInsert(files, pos);
					return true;
				},
				// Paste handler: same idea for clipboard images.
				handlePaste: (view, event) => {
					const items = event.clipboardData?.items;
					if (!items) return false;
					const files: File[] = [];
					for (const item of items) {
						if (item.kind === 'file' && item.type.startsWith('image/')) {
							const f = item.getAsFile();
							if (f) files.push(f);
						}
					}
					if (files.length === 0) return false;
					event.preventDefault();
					void uploadAndInsert(files);
					return true;
				}
			},
			onUpdate({ editor }) {
				// `storage.markdown.getMarkdown()` is provided by tiptap-markdown.
				const md = ((
					editor.storage as unknown as Record<string, { getMarkdown?: () => string } | undefined>
				).markdown?.getMarkdown?.() ?? '') as string;
				lastEmitted = md;
				value = md;
				onChange?.(md);
				dispatch('change', md);
			}
		});

		ready = true;
	}

	async function uploadOne(file: File): Promise<{ url: string; alt: string } | null> {
		const fd = new FormData();
		fd.append('file', file);
		const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
		if (!res.ok) {
			const txt = await res.text().catch(() => '');
			uploadError = `upload failed (${res.status}): ${txt || 'unknown error'}`;
			return null;
		}
		const json = (await res.json()) as { url: string };
		const alt = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'image';
		return { url: json.url, alt };
	}

	async function uploadAndInsert(files: File[], pos?: number) {
		if (!editor) return;
		uploadError = '';
		uploading = true;
		try {
			for (const file of files) {
				const result = await uploadOne(file);
				if (!result) continue;
				const chain = editor.chain().focus();
				if (typeof pos === 'number') chain.setTextSelection(pos);
				chain.setImage({ src: result.url, alt: result.alt }).run();
			}
		} finally {
			uploading = false;
		}
	}

	function onFilePicked(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = Array.from(target.files ?? []).filter((f) => f.type.startsWith('image/'));
		if (files.length > 0) void uploadAndInsert(files);
		target.value = '';
	}

	function pickImage() {
		fileInput?.click();
	}

	function promptLink() {
		if (!editor) return;
		const prev = editor.getAttributes('link').href as string | undefined;
		const url = window.prompt('URL', prev ?? 'https://');
		if (url === null) return;
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	}

	// React to parent-driven value changes (e.g. reset / load-from-server).
	// Skip the echo from our own onUpdate.
	$: if (editor && value !== lastEmitted) {
		const md = ((
			editor.storage as unknown as Record<string, { getMarkdown?: () => string } | undefined>
		).markdown?.getMarkdown?.() ?? '') as string;
		if (md !== value) {
			editor.commands.setContent(value || '', { emitUpdate: false });
		}
	}

	onMount(() => {
		init().catch((err) => {
			// Surface init failures — in production this means Tiptap couldn't
			// load (network or syntax error). Show the user a usable message
			// instead of failing silently.
			uploadError = `editor failed to initialise: ${(err as Error).message}`;

			console.error('[MarkdownEditor] init failed', err);
		});
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	// Helper for toolbar button reactivity. Svelte 4 doesn't reactively track
	// editor state changes, so we tick a counter on every transaction.
	let stateTick = 0;
	$: if (editor) {
		editor.off('transaction');
		editor.on('transaction', () => {
			stateTick++;
		});
	}

	function isActive(name: string, attrs?: Record<string, unknown>): boolean {
		// `stateTick` is read so Svelte recomputes when transactions fire.
		void stateTick;
		return editor?.isActive(name, attrs) ?? false;
	}
</script>

<div class="md-editor" class:ready>
	<div class="toolbar" role="toolbar" aria-label="Editor toolbar">
		<button
			type="button"
			title="Bold (Cmd+B)"
			aria-pressed={isActive('bold')}
			class:active={isActive('bold')}
			on:click={() => editor?.chain().focus().toggleBold().run()}
			disabled={!ready}
		>
			<strong>B</strong>
		</button>
		<button
			type="button"
			title="Italic (Cmd+I)"
			aria-pressed={isActive('italic')}
			class:active={isActive('italic')}
			on:click={() => editor?.chain().focus().toggleItalic().run()}
			disabled={!ready}
		>
			<em>I</em>
		</button>
		<button
			type="button"
			title="Inline code"
			aria-pressed={isActive('code')}
			class:active={isActive('code')}
			on:click={() => editor?.chain().focus().toggleCode().run()}
			disabled={!ready}
		>
			<code>&lt;&gt;</code>
		</button>
		<button
			type="button"
			title="Link (Cmd+K)"
			aria-pressed={isActive('link')}
			class:active={isActive('link')}
			on:click={promptLink}
			disabled={!ready}
		>
			link
		</button>
		<span class="sep" aria-hidden="true">|</span>
		<button
			type="button"
			title="Heading 2"
			aria-pressed={isActive('heading', { level: 2 })}
			class:active={isActive('heading', { level: 2 })}
			on:click={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
			disabled={!ready}
		>
			H2
		</button>
		<button
			type="button"
			title="Heading 3"
			aria-pressed={isActive('heading', { level: 3 })}
			class:active={isActive('heading', { level: 3 })}
			on:click={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
			disabled={!ready}
		>
			H3
		</button>
		<span class="sep" aria-hidden="true">|</span>
		<button
			type="button"
			title="Bullet list"
			aria-pressed={isActive('bulletList')}
			class:active={isActive('bulletList')}
			on:click={() => editor?.chain().focus().toggleBulletList().run()}
			disabled={!ready}
		>
			• list
		</button>
		<button
			type="button"
			title="Numbered list"
			aria-pressed={isActive('orderedList')}
			class:active={isActive('orderedList')}
			on:click={() => editor?.chain().focus().toggleOrderedList().run()}
			disabled={!ready}
		>
			1. list
		</button>
		<button
			type="button"
			title="Blockquote"
			aria-pressed={isActive('blockquote')}
			class:active={isActive('blockquote')}
			on:click={() => editor?.chain().focus().toggleBlockquote().run()}
			disabled={!ready}
		>
			❝
		</button>
		<button
			type="button"
			title="Code block"
			aria-pressed={isActive('codeBlock')}
			class:active={isActive('codeBlock')}
			on:click={() => editor?.chain().focus().toggleCodeBlock().run()}
			disabled={!ready}
		>
			{`{ }`}
		</button>
		<button
			type="button"
			title="Horizontal rule"
			on:click={() => editor?.chain().focus().setHorizontalRule().run()}
			disabled={!ready}
		>
			—
		</button>
		<span class="sep" aria-hidden="true">|</span>
		<button type="button" title="Insert image" on:click={pickImage} disabled={!ready || uploading}>
			{uploading ? '⏳ image' : 'image'}
		</button>
		<span class="grow"></span>
		<button
			type="button"
			title="Undo (Cmd+Z)"
			on:click={() => editor?.chain().focus().undo().run()}
			disabled={!ready}
		>
			↶
		</button>
		<button
			type="button"
			title="Redo (Cmd+Shift+Z)"
			on:click={() => editor?.chain().focus().redo().run()}
			disabled={!ready}
		>
			↷
		</button>
	</div>

	<div bind:this={editorEl} class="surface" data-testid="markdown-editor-surface"></div>

	<input
		bind:this={fileInput}
		type="file"
		accept="image/png,image/jpeg,image/webp,image/gif"
		multiple
		hidden
		on:change={onFilePicked}
	/>

	{#if uploadError}
		<p class="upload-error" role="alert">{uploadError}</p>
	{/if}
</div>

<style>
	.md-editor {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-green-light, #c7d6c7);
		border-radius: 4px;
		background: var(--color-bg, #fff);
		min-height: 16rem;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.4rem;
		border-bottom: 1px solid var(--color-green-light, #c7d6c7);
		background: var(--color-green-lightest, #f5faf5);
		align-items: center;
	}
	.toolbar button {
		min-width: 2rem;
		padding: 0.25rem 0.5rem;
		font: inherit;
		font-size: 0.9rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 3px;
		cursor: pointer;
		line-height: 1.2;
	}
	.toolbar button:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.06);
	}
	.toolbar button.active {
		background: rgba(0, 0, 0, 0.12);
		border-color: rgba(0, 0, 0, 0.2);
	}
	.toolbar button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.toolbar .sep {
		color: rgba(0, 0, 0, 0.2);
		padding: 0 0.25rem;
	}
	.toolbar .grow {
		flex: 1;
	}
	.surface {
		flex: 1;
		min-height: 14rem;
		padding: 0.75rem 1rem;
		overflow: auto;
	}
	.surface :global(.tiptap-content) {
		outline: none;
		min-height: 12rem;
	}
	.surface :global(.tiptap-content p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		color: rgba(0, 0, 0, 0.35);
		pointer-events: none;
		height: 0;
	}
	.surface :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: 3px;
	}
	.surface :global(blockquote) {
		border-left: 3px solid var(--color-green-light, #c7d6c7);
		padding-left: 0.75rem;
		color: rgba(0, 0, 0, 0.7);
		margin: 0.5rem 0;
	}
	.surface :global(pre) {
		background: rgba(0, 0, 0, 0.05);
		padding: 0.5rem 0.75rem;
		border-radius: 3px;
		overflow-x: auto;
	}
	.surface :global(code) {
		background: rgba(0, 0, 0, 0.06);
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
		font-size: 0.92em;
	}
	.surface :global(pre code) {
		background: transparent;
		padding: 0;
	}
	.upload-error {
		color: var(--color-red, #c00);
		padding: 0 0.75rem 0.5rem;
		margin: 0;
		font-size: 0.9rem;
	}
</style>
