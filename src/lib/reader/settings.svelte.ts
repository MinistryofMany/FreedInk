import { browser } from '$app/environment';

export interface ReaderFont {
	value: string;
	label: string;
}

export const READER_FONTS: ReaderFont[] = [
	{ value: "'Atkinson Hyperlegible', sans-serif", label: 'Atkinson Hyperlegible' },
	{ value: "'Source Serif 4 Variable', serif", label: 'Source Serif 4' },
	{ value: "'Literata Variable', serif", label: 'Literata' },
	{ value: "'Newsreader Variable', serif", label: 'Newsreader' },
	{ value: "'Lora Variable', serif", label: 'Lora' },
	{ value: "'Inter Variable', sans-serif", label: 'Inter' }
];

export const READER_WIDTHS = [
	{ value: 500, label: 'Narrow' },
	{ value: 600, label: 'Medium' },
	{ value: 760, label: 'Wide' }
];

export const READER_LINES = [
	{ value: 1.45, label: 'Tight' },
	{ value: 1.6, label: 'Normal' },
	{ value: 1.8, label: 'Loose' }
];

export const SIZE_MIN = 14;
export const SIZE_MAX = 24;

const KEY = 'freedink_reader';
const DEFAULTS = { font: READER_FONTS[0].value, size: 17, width: 600, line: 1.6 };

export const reader = $state({ ...DEFAULTS });

/** Hydrate from localStorage. Call once in the browser (e.g. onMount). No-op on server. */
export function loadReader(): void {
	if (!browser) return;
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return;
		const s = JSON.parse(raw);
		if (s && typeof s === 'object') {
			if (typeof s.font === 'string') reader.font = s.font;
			if (typeof s.size === 'number') reader.size = clampSize(s.size);
			if (typeof s.width === 'number') reader.width = s.width;
			if (typeof s.line === 'number') reader.line = s.line;
		}
	} catch {
		/* ignore malformed storage */
	}
}

function clampSize(n: number): number {
	return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));
}

function persist(): void {
	if (!browser) return;
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({
				font: reader.font,
				size: reader.size,
				width: reader.width,
				line: reader.line
			})
		);
	} catch {
		/* quota / disabled */
	}
}

export function setFont(v: string): void {
	reader.font = v;
	persist();
}

export function setSize(n: number): void {
	reader.size = clampSize(n);
	persist();
}

export function setWidth(n: number): void {
	reader.width = n;
	persist();
}

export function setLine(n: number): void {
	reader.line = n;
	persist();
}

export function resetReader(): void {
	Object.assign(reader, DEFAULTS);
	persist();
}
