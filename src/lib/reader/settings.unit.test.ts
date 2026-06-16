// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	reader,
	READER_FONTS,
	SIZE_MIN,
	SIZE_MAX,
	loadReader,
	setFont,
	setSize,
	setWidth,
	setLine,
	resetReader
} from './settings.svelte';

const KEY = 'freedink_reader';
const DEFAULTS = { font: READER_FONTS[0].value, size: 17, width: 600, line: 1.6 };

afterEach(() => {
	localStorage.clear();
	resetReader();
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('reader defaults', () => {
	it('applies the documented defaults', () => {
		expect(reader.font).toBe(DEFAULTS.font);
		expect(reader.size).toBe(17);
		expect(reader.width).toBe(600);
		expect(reader.line).toBe(1.6);
	});
});

describe('setSize clamping', () => {
	it('clamps below the minimum to SIZE_MIN', () => {
		setSize(2);
		expect(reader.size).toBe(SIZE_MIN);
	});

	it('clamps above the maximum to SIZE_MAX', () => {
		setSize(99);
		expect(reader.size).toBe(SIZE_MAX);
	});

	it('rounds fractional values', () => {
		setSize(18.6);
		expect(reader.size).toBe(19);
	});

	it('keeps an in-range integer unchanged', () => {
		setSize(20);
		expect(reader.size).toBe(20);
	});
});

describe('setters update reader', () => {
	it('setFont updates the font', () => {
		const next = READER_FONTS[2].value;
		setFont(next);
		expect(reader.font).toBe(next);
	});

	it('setWidth updates the width', () => {
		setWidth(760);
		expect(reader.width).toBe(760);
	});

	it('setLine updates the line height', () => {
		setLine(1.8);
		expect(reader.line).toBe(1.8);
	});
});

describe('persistence', () => {
	it('writes the current state to localStorage on each setter', () => {
		const spy = vi.spyOn(Storage.prototype, 'setItem');
		setFont(READER_FONTS[3].value);
		setSize(21);
		setWidth(500);
		setLine(1.45);
		expect(spy).toHaveBeenCalled();
		const persisted = JSON.parse(localStorage.getItem(KEY) as string);
		expect(persisted).toEqual({
			font: READER_FONTS[3].value,
			size: 21,
			width: 500,
			line: 1.45
		});
	});

	it('round-trips: loadReader hydrates reader from localStorage', () => {
		const stored = {
			font: READER_FONTS[4].value,
			size: 22,
			width: 760,
			line: 1.8
		};
		localStorage.setItem(KEY, JSON.stringify(stored));
		loadReader();
		expect(reader.font).toBe(stored.font);
		expect(reader.size).toBe(22);
		expect(reader.width).toBe(760);
		expect(reader.line).toBe(1.8);
	});

	it('loadReader clamps a persisted out-of-range size', () => {
		localStorage.setItem(KEY, JSON.stringify({ size: 999 }));
		loadReader();
		expect(reader.size).toBe(SIZE_MAX);
	});

	it('loadReader ignores malformed storage', () => {
		localStorage.setItem(KEY, 'not json');
		loadReader();
		expect(reader.font).toBe(DEFAULTS.font);
		expect(reader.size).toBe(17);
	});

	it('loadReader is a no-op when nothing is stored', () => {
		loadReader();
		expect(reader.size).toBe(17);
		expect(reader.width).toBe(600);
	});
});

describe('resetReader', () => {
	it('restores defaults and persists them', () => {
		setSize(24);
		setWidth(760);
		resetReader();
		expect(reader.size).toBe(17);
		expect(reader.width).toBe(600);
		expect(reader.font).toBe(DEFAULTS.font);
		expect(reader.line).toBe(1.6);
		const persisted = JSON.parse(localStorage.getItem(KEY) as string);
		expect(persisted).toEqual(DEFAULTS);
	});
});
