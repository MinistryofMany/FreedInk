// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Card from './Card.svelte';

const text = createRawSnippet(() => ({ render: () => '<p>content</p>' }));

function mountCard(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Card, { target, props: { children: text, ...props } });
	return target;
}

afterEach(() => {
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('Card', () => {
	it('mounts without throwing and defaults to md padding', () => {
		const target = mountCard();
		const el = target.querySelector('div.card');
		expect(el).not.toBeNull();
		expect(el!.classList.contains('pad-md')).toBe(true);
	});

	it('applies pad-sm class when padding is sm', () => {
		const target = mountCard({ padding: 'sm' });
		const el = target.querySelector('div.card');
		expect(el!.classList.contains('pad-sm')).toBe(true);
		expect(el!.classList.contains('pad-md')).toBe(false);
	});

	it('applies pad-lg class when padding is lg', () => {
		const target = mountCard({ padding: 'lg' });
		const el = target.querySelector('div.card');
		expect(el!.classList.contains('pad-lg')).toBe(true);
	});

	it('adds elevated class when elevated is true', () => {
		const target = mountCard({ elevated: true });
		const el = target.querySelector('div.card');
		expect(el!.classList.contains('elevated')).toBe(true);
	});

	it('omits elevated class when elevated is false', () => {
		const target = mountCard({ elevated: false });
		const el = target.querySelector('div.card');
		expect(el!.classList.contains('elevated')).toBe(false);
	});

	it('forwards extra class prop', () => {
		const target = mountCard({ class: 'my-card' });
		const el = target.querySelector('div.card');
		expect(el!.classList.contains('my-card')).toBe(true);
	});
});
