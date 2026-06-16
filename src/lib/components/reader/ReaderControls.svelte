<script lang="ts">
	import { browser } from '$app/environment';
	import { Popover } from 'bits-ui';
	import { SegmentedControl } from '$lib/components/ui';
	import {
		reader,
		READER_FONTS,
		READER_WIDTHS,
		READER_LINES,
		SIZE_MIN,
		SIZE_MAX,
		setFont,
		setSize,
		setWidth,
		setLine
	} from '$lib/reader/settings.svelte';

	// ── Typeface roving-radiogroup focus (mirrors SegmentedControl's pattern) ──
	function handleFontKeydown(e: KeyboardEvent, idx: number) {
		const last = READER_FONTS.length - 1;
		let next: number | null = null;
		if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1;
		else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = last;
		if (next === null) return;
		e.preventDefault();
		setFont(READER_FONTS[next].value);
		const group = (e.currentTarget as HTMLElement).parentElement;
		group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}

	// ── Width & line: CONTROLLED by the reader module (single source of truth) ──
	// The SegmentedControls take a plain `value=` derived from `reader.*` and push
	// changes back through the setter via `onValueChange`. No local mirror, so a
	// later `loadReader()` (which sets reader.width/line from localStorage) can't
	// be clobbered by a stale mirror value.
	function selectWidth(v: string) {
		setWidth(Number(v));
	}
	function selectLine(v: string) {
		setLine(Number(v));
	}

	// ── Theme (mirrors ThemeToggle.svelte's DOM + cookie logic) ───────────────
	// Theme lives in the document attribute + cookie, not the reader module.
	let themeSel = $state<string>(
		browser ? (document.documentElement.getAttribute('data-theme') ?? 'auto') : 'auto'
	);
	function selectTheme(v: string) {
		themeSel = v;
		if (!browser) return;
		if (v === 'light' || v === 'dark') {
			document.documentElement.setAttribute('data-theme', v);
			document.cookie = `freedink_theme=${v}; path=/; max-age=31536000; SameSite=Lax`;
		} else {
			document.documentElement.removeAttribute('data-theme');
			document.cookie = `freedink_theme=; path=/; max-age=0`;
		}
	}

	const widthOptions = READER_WIDTHS.map((w) => ({ value: String(w.value), label: w.label }));
	const lineOptions = READER_LINES.map((l) => ({ value: String(l.value), label: l.label }));
	const themeOptions = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'auto', label: 'Auto' }
	];
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button {...props} class="aa-btn" aria-label="Reading settings">Aa</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content class="reader-panel" sideOffset={8} align="end">
			<div class="group">
				<span class="group-label" id="typeface-label">Typeface</span>
				<div class="typeface" role="radiogroup" aria-labelledby="typeface-label">
					{#each READER_FONTS as f, idx (f.value)}
						<button
							type="button"
							role="radio"
							aria-checked={reader.font === f.value}
							tabindex={reader.font === f.value ? 0 : -1}
							class="type-option"
							class:selected={reader.font === f.value}
							style="font-family: {f.value}"
							onclick={() => setFont(f.value)}
							onkeydown={(e) => handleFontKeydown(e, idx)}>{f.label}</button
						>
					{/each}
				</div>
			</div>

			<div class="group">
				<span class="group-label">Text size</span>
				<div class="size" role="group" aria-label="Text size">
					<button
						type="button"
						class="size-btn"
						onclick={() => setSize(reader.size - 1)}
						disabled={reader.size <= SIZE_MIN}
						aria-label="Decrease text size">A−</button
					>
					<span class="size-value" aria-live="polite">{reader.size} px</span>
					<button
						type="button"
						class="size-btn"
						onclick={() => setSize(reader.size + 1)}
						disabled={reader.size >= SIZE_MAX}
						aria-label="Increase text size">A+</button
					>
				</div>
			</div>

			<div class="group">
				<span class="group-label">Width</span>
				<SegmentedControl
					options={widthOptions}
					value={String(reader.width)}
					onValueChange={selectWidth}
					ariaLabel="Width"
				/>
			</div>

			<div class="group">
				<span class="group-label">Line spacing</span>
				<SegmentedControl
					options={lineOptions}
					value={String(reader.line)}
					onValueChange={selectLine}
					ariaLabel="Line spacing"
				/>
			</div>

			<div class="group">
				<span class="group-label">Theme</span>
				<SegmentedControl
					options={themeOptions}
					value={themeSel}
					onValueChange={selectTheme}
					ariaLabel="Theme"
				/>
			</div>

			<p class="saved-note">Saved on your device.</p>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	.aa-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--touch-target);
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--text-base);
		font-weight: 600;
		background: transparent;
		color: var(--color-text);
		border: var(--border-1) solid var(--color-border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--transition-fast) var(--ease);
	}
	.aa-btn:hover {
		background: var(--color-surface-alt);
	}

	:global(.reader-panel) {
		z-index: 50;
		width: 240px;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elev-2);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.group-label {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}

	.typeface {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.type-option {
		text-align: left;
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-base);
		background: transparent;
		color: var(--color-text);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background var(--transition-fast) var(--ease),
			border-color var(--transition-fast) var(--ease);
	}
	.type-option:hover {
		background: var(--color-surface-alt);
	}
	.type-option.selected {
		border-color: var(--color-accent);
		color: var(--color-accent);
		font-weight: 600;
	}

	.size {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.size-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2rem;
		min-width: 2.5rem;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		background: var(--color-surface-alt);
		color: var(--color-text);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--transition-fast) var(--ease);
	}
	.size-btn:hover:not(:disabled) {
		background: var(--color-border);
	}
	.size-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.size-value {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text);
		min-width: 3.5rem;
		text-align: center;
	}

	.saved-note {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
