import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, parseLimit } from './pagination';

describe('encodeCursor / decodeCursor', () => {
	it('roundtrips a simple object', () => {
		const payload = { key: '2024-01-01T00:00:00.000Z', id: 'abc-123' };
		const token = encodeCursor(payload);
		expect(typeof token).toBe('string');
		expect(token.length).toBeGreaterThan(0);
		expect(decodeCursor<typeof payload>(token)).toEqual(payload);
	});

	it('produces a URL-safe token (no +, /, or =)', () => {
		// JSON containing characters that produce + and / in standard base64.
		const token = encodeCursor({ key: '????>>>', id: '<<<<' });
		expect(token).not.toMatch(/[+/=]/);
	});

	it('roundtrips unicode strings', () => {
		const payload = { key: 'café ☃', id: '🚀' };
		const token = encodeCursor(payload);
		expect(decodeCursor(token)).toEqual(payload);
	});

	it('returns null for null/undefined/empty input', () => {
		expect(decodeCursor(null)).toBeNull();
		expect(decodeCursor(undefined)).toBeNull();
		expect(decodeCursor('')).toBeNull();
	});

	it('returns null for malformed cursors', () => {
		expect(decodeCursor('!!!not-base64!!!')).toBeNull();
		expect(decodeCursor('aGVsbG8=')).toBeNull(); // valid base64, but "hello" is not JSON
		expect(decodeCursor('bnVsbA==')).toBeNull(); // "null" parses but isn't an object
		expect(decodeCursor('MTIz')).toBeNull(); // "123" — JSON-valid scalar, not an object
	});
});

describe('parseLimit', () => {
	it('returns default for null / undefined / empty', () => {
		expect(parseLimit(null)).toBe(20);
		expect(parseLimit(undefined)).toBe(20);
		expect(parseLimit('')).toBe(20);
	});

	it('returns parsed value within bounds', () => {
		expect(parseLimit('10')).toBe(10);
		expect(parseLimit('1')).toBe(1);
		expect(parseLimit('100')).toBe(100);
	});

	it('clamps to max', () => {
		expect(parseLimit('500')).toBe(100);
		expect(parseLimit('1000000')).toBe(100);
	});

	it('falls back to default for non-positive or non-integer values', () => {
		expect(parseLimit('0')).toBe(20);
		expect(parseLimit('-5')).toBe(20);
		expect(parseLimit('abc')).toBe(20);
		expect(parseLimit('3.5')).toBe(20);
		expect(parseLimit('NaN')).toBe(20);
	});

	it('respects custom defaults and maxes', () => {
		expect(parseLimit(null, 5, 50)).toBe(5);
		expect(parseLimit('200', 5, 50)).toBe(50);
		expect(parseLimit('25', 5, 50)).toBe(25);
	});
});
