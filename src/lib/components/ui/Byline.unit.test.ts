// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import Byline from './Byline.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('Byline', () => {
	it('mounts and renders the author name', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Byline, { target, props: { author: 'Jane Doe' } });
		expect(target.textContent).toContain('Jane Doe');
	});

	it('renders "By" prefix before the author', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Byline, { target, props: { author: 'Jane Doe' } });
		expect(target.textContent).toContain('By');
	});

	it('renders no meta items when meta is empty (default)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Byline, { target, props: { author: 'Jane Doe' } });
		const dots = target.querySelectorAll('.dot');
		expect(dots.length).toBe(0);
	});

	it('renders the correct number of meta items and separator dots', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Byline, { target, props: { author: 'Jane Doe', meta: ['June 2026', '5 min read'] } });
		const metaItems = target.querySelectorAll('.meta-item');
		expect(metaItems.length).toBe(2);
		const dots = target.querySelectorAll('.dot');
		expect(dots.length).toBe(2);
		expect(target.textContent).toContain('June 2026');
		expect(target.textContent).toContain('5 min read');
	});

	it('renders author in a strong element', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Byline, { target, props: { author: 'Jane Doe' } });
		const strong = target.querySelector('strong');
		expect(strong).not.toBeNull();
		expect(strong!.textContent).toBe('Jane Doe');
	});
});
