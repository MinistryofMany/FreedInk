// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from './contrast';

const css = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8');

/** Extract a `--name: #hex;` value from a given CSS block. */
function token(block: string, name: string): string {
	const m = block.match(new RegExp(`--${name}:\\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))`));
	if (!m) throw new Error(`token --${name} not found`);
	return m[1];
}

function blockOf(selector: string): string {
	const i = css.indexOf(selector);
	if (i === -1) throw new Error(`selector ${selector} not found`);
	const start = css.indexOf('{', i);
	const end = css.indexOf('}', start);
	return css.slice(start, end);
}

/** Parse all `--name: value;` declarations in a block into a map. */
function tokenMap(block: string): Record<string, string> {
	const map: Record<string, string> = {};
	const re = /--([a-z0-9-]+):\s*([^;]+);/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(block))) map[m[1]] = m[2].trim();
	return map;
}

const light = blockOf(':root {');
const dark = blockOf(":root[data-theme='dark']");
// The OS-dark path (media query) and the manual-dark path (attribute) duplicate
// the dark palette; this block is the media-query copy.
const mediaDark = blockOf(":root:not([data-theme='light'])");

const textPairs = [
	['bg', 'text'],
	['bg', 'text-muted'],
	['bg', 'accent'],
	['bg', 'link'],
	['bg', 'link-hover'],
	['bg', 'danger']
];
const nonTextPairs = [['bg', 'border-strong']];

describe.each([
	['light', light],
	['dark', dark]
])('%s palette meets WCAG AA', (_name, block) => {
	it.each(textPairs)('text: %s vs %s >= 4.5', (bg, fg) => {
		expect(
			contrastRatio(token(block, `color-${bg}`), token(block, `color-${fg}`))
		).toBeGreaterThanOrEqual(4.5);
	});
	it.each(nonTextPairs)('non-text: %s vs %s >= 3.0', (bg, fg) => {
		expect(
			contrastRatio(token(block, `color-${bg}`), token(block, `color-${fg}`))
		).toBeGreaterThanOrEqual(3.0);
	});
	it('focus ring vs bg >= 3.0', () => {
		expect(
			contrastRatio(token(block, 'color-bg'), token(block, 'focus-ring-color'))
		).toBeGreaterThanOrEqual(3.0);
	});
});

it('OS-dark and manual-dark palettes are identical (no drift)', () => {
	expect(tokenMap(mediaDark)).toEqual(tokenMap(dark));
});
