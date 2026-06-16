// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import DropdownMenu from './DropdownMenu.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

const items = [
	{ label: 'Edit', onSelect: vi.fn() },
	{ label: 'Archive', onSelect: vi.fn() },
	{ label: 'Delete', onSelect: vi.fn(), danger: true }
];

const customTrigger = createRawSnippet(() => ({
	render: () => '<button>Options</button>',
	setup: () => {}
}));

describe('DropdownMenu', () => {
	it('renders the default kebab trigger button', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(DropdownMenu, { target, props: { items } });
		// Default trigger is a button with aria-label="Menu"
		const trigger = target.querySelector('[aria-label="Menu"]');
		expect(trigger).not.toBeNull();
	});

	it('renders a custom trigger snippet when provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(DropdownMenu, { target, props: { items, trigger: customTrigger } });
		expect(target.textContent).toContain('Options');
	});

	it('trigger button is present in the DOM', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(DropdownMenu, { target, props: { items } });
		const btn = target.querySelector('button');
		expect(btn).not.toBeNull();
	});

	it('default trigger has correct aria-label for accessibility', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(DropdownMenu, { target, props: { items } });
		const trigger = target.querySelector('button');
		expect(trigger?.getAttribute('aria-label')).toBe('Menu');
	});
});
