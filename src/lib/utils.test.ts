import { describe, it, expect } from 'vitest';
import { sluggify, unslug, hashToField } from './utils';

const BN254 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe('sluggify', () => {
	it('lowercases and replaces spaces with hyphens', () => {
		expect(sluggify('Hello World')).toBe('hello-world');
	});

	it('strips disallowed characters', () => {
		expect(sluggify('Hello, World!')).toBe('hello-world');
		expect(sluggify('Café')).toBe('caf');
		expect(sluggify('a/b\\c?d#e')).toBe('abcde');
	});

	it('preserves allowed punctuation', () => {
		expect(sluggify('a-b_c-d')).toBe('a-b_c-d');
	});

	it('handles empty input', () => {
		expect(sluggify('')).toBe('');
	});

	it('is idempotent', () => {
		const once = sluggify('My Cool Post!');
		expect(sluggify(once)).toBe(once);
	});
});

describe('unslug', () => {
	it('replaces hyphens with spaces', () => {
		expect(unslug('hello-world')).toBe('hello world');
	});
});

describe('hashToField', () => {
	it('is deterministic for the same input', async () => {
		const a = await hashToField('post:foo');
		const b = await hashToField('post:foo');
		expect(a).toBe(b);
	});

	it('produces different outputs for different inputs', async () => {
		const a = await hashToField('approve');
		const b = await hashToField('reject');
		expect(a).not.toBe(b);
	});

	it('is always strictly less than the BN254 field prime', async () => {
		const samples = await Promise.all(
			Array.from({ length: 50 }, (_, i) => hashToField(`scope:${i}`))
		);
		for (const v of samples) {
			expect(v < BN254).toBe(true);
			expect(v >= 0n).toBe(true);
		}
	});

	it('returns a BigInt, not a string', async () => {
		expect(typeof (await hashToField('x'))).toBe('bigint');
	});

	it('handles the empty string without throwing', async () => {
		const v = await hashToField('');
		expect(typeof v).toBe('bigint');
		expect(v < BN254).toBe(true);
	});

	it('handles unicode correctly', async () => {
		const a = await hashToField('café');
		const b = await hashToField('cafe');
		expect(a).not.toBe(b);
	});
});
