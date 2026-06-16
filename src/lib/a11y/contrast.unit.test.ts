import { describe, it, expect } from 'vitest';
import { contrastRatio, meetsAA } from './contrast';

describe('contrastRatio', () => {
	it('returns 21:1 for black on white', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
	});
	it('returns 1:1 for identical colors', () => {
		expect(contrastRatio('#1a1411', '#1a1411')).toBeCloseTo(1, 5);
	});
	it('is order-independent', () => {
		expect(contrastRatio('#faf7f0', '#1f5240')).toBeCloseTo(contrastRatio('#1f5240', '#faf7f0'), 5);
	});
	it('accepts 3-digit hex', () => {
		expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 0);
	});
});

describe('meetsAA', () => {
	it('requires 4.5 for normal text', () => {
		expect(meetsAA(4.5)).toBe(true);
		expect(meetsAA(4.49)).toBe(false);
	});
	it('requires 3.0 for large text / non-text', () => {
		expect(meetsAA(3.0, { large: true })).toBe(true);
		expect(meetsAA(2.99, { large: true })).toBe(false);
	});
});
