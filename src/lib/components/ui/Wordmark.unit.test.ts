// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import Wordmark from './Wordmark.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('Wordmark', () => {
	it('renders an <a href="/"> by default containing text "FreedInk"', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Wordmark, { target, props: {} });
		const a = target.querySelector('a');
		expect(a).not.toBeNull();
		expect(a!.getAttribute('href')).toBe('/');
		expect(a!.textContent).toBe('FreedInk');
	});

	it('renders <span> when as="span"', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Wordmark, { target, props: { as: 'span' } });
		expect(target.querySelector('a')).toBeNull();
		const span = target.querySelector('span.wordmark');
		expect(span).not.toBeNull();
		expect(span!.textContent).toBe('FreedInk');
	});

	it('uses the provided href', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Wordmark, { target, props: { href: '/about' } });
		const a = target.querySelector('a');
		expect(a!.getAttribute('href')).toBe('/about');
	});

	it('passes extra class through', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Wordmark, { target, props: { class: 'custom' } });
		const a = target.querySelector('a');
		expect(a!.className).toContain('custom');
	});
});
