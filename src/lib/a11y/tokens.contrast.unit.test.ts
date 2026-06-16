// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from './contrast';

const css = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8');

/** Extract a `--name: #hex;` value from a given CSS block. */
function token(block: string, name: string): string {
	const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`));
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

const light = blockOf(':root {');
const dark = blockOf(":root[data-theme='dark']");

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
