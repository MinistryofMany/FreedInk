// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet, flushSync } from 'svelte';
import Dialog from './Dialog.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

const bodySnippet = createRawSnippet(() => ({
	render: () => '<p>Dialog body content</p>',
	setup: () => {}
}));

const triggerSnippet = createRawSnippet(() => ({
	render: () => '<button>Open</button>',
	setup: () => {}
}));

describe('Dialog', () => {
	it('renders the title in the document when open=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Dialog, {
			target,
			props: { open: true, title: 'Test Title', children: bodySnippet }
		});
		flushSync();
		// Bits portals to document.body - query the full body
		expect(document.body.textContent).toContain('Test Title');
	});

	it('renders the description when provided and open=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Dialog, {
			target,
			props: {
				open: true,
				title: 'My Dialog',
				description: 'A helpful description',
				children: bodySnippet
			}
		});
		flushSync();
		expect(document.body.textContent).toContain('A helpful description');
	});

	it('does not render description element when description prop is absent', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Dialog, {
			target,
			props: { open: true, title: 'No Desc', children: bodySnippet }
		});
		flushSync();
		// Ensure the title renders but no description class element
		expect(document.body.textContent).toContain('No Desc');
		expect(document.body.querySelector('.fi-dialog-desc')).toBeNull();
	});

	it('renders the children snippet when open=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Dialog, {
			target,
			props: { open: true, title: 'Has Body', children: bodySnippet }
		});
		flushSync();
		expect(document.body.textContent).toContain('Dialog body content');
	});

	it('renders a close button with aria-label="Close"', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Dialog, {
			target,
			props: { open: true, title: 'Close Test', children: bodySnippet }
		});
		flushSync();
		const closeBtn = document.body.querySelector('[aria-label="Close"]');
		expect(closeBtn).not.toBeNull();
	});

	it('renders the trigger snippet when provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Dialog, {
			target,
			props: { open: false, title: 'Trigger Test', trigger: triggerSnippet, children: bodySnippet }
		});
		flushSync();
		// Trigger lives in target, not portal
		expect(target.textContent).toContain('Open');
	});

	it('does not render dialog content when open=false', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Dialog, {
			target,
			props: { open: false, title: 'Hidden', children: bodySnippet }
		});
		flushSync();
		// Bits only renders portal content when open; title should not appear
		expect(document.body.textContent).not.toContain('Hidden');
	});
});
