// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import { createRawSnippet } from 'svelte';
import PullQuote from './PullQuote.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('PullQuote', () => {
	it('mounts and renders a blockquote element', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const children = createRawSnippet(() => ({
			render: () => '<span>Test quote</span>',
			setup: () => {}
		}));
		mount(PullQuote, { target, props: { children } });
		expect(target.querySelector('blockquote')).not.toBeNull();
	});

	it('renders children content inside the blockquote', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const children = createRawSnippet(() => ({
			render: () => '<span>A great pull quote</span>',
			setup: () => {}
		}));
		mount(PullQuote, { target, props: { children } });
		const bq = target.querySelector('blockquote');
		expect(bq!.textContent).toContain('A great pull quote');
	});

	it('forwards extra class prop', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const children = createRawSnippet(() => ({
			render: () => '<span>quote</span>',
			setup: () => {}
		}));
		mount(PullQuote, { target, props: { children, class: 'featured' } });
		const bq = target.querySelector('blockquote');
		expect(bq!.classList.contains('featured')).toBe(true);
	});
});
