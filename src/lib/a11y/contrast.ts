// WCAG 2.1 relative-luminance contrast. Pure, dependency-free.

function expand(hex: string): string {
	const h = hex.replace('#', '').trim();
	if (h.length === 3)
		return h
			.split('')
			.map((c) => c + c)
			.join('');
	if (h.length !== 6) throw new Error(`unsupported hex color: ${hex}`);
	return h;
}

function channelLinear(srgb: number): number {
	const c = srgb / 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
	const h = expand(hex);
	const r = channelLinear(parseInt(h.slice(0, 2), 16));
	const g = channelLinear(parseInt(h.slice(2, 4), 16));
	const b = channelLinear(parseInt(h.slice(4, 6), 16));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colors, 1..21. Order-independent. */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA: 4.5 for normal text, 3.0 for large text / non-text UI. */
export function meetsAA(ratio: number, opts: { large?: boolean } = {}): boolean {
	return ratio >= (opts.large ? 3.0 : 4.5);
}
