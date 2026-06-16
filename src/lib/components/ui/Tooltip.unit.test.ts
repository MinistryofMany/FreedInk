// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Tooltip from './Tooltip.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

const triggerContent = createRawSnippet(() => ({
	render: () => '<button>Hover me</button>',
	setup: () => {}
}));

describe('Tooltip', () => {
	it('renders the trigger children', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Tooltip, { target, props: { text: 'Helpful info', children: triggerContent } });
		expect(target.textContent).toContain('Hover me');
	});

	it('mounts without errors', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		expect(() => {
			mount(Tooltip, { target, props: { text: 'A tooltip', children: triggerContent } });
		}).not.toThrow();
	});

	it('renders the trigger wrapper element', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Tooltip, { target, props: { text: 'Info', children: triggerContent } });
		// Bits renders a trigger element; the child content appears inside
		const btn = target.querySelector('button');
		expect(btn).not.toBeNull();
		expect(btn?.textContent).toContain('Hover me');
	});

	// Note: tooltip content in jsdom does not render on hover since Bits uses
	// pointer events and floating-ui positioning that require a browser environment.
	// The tooltip text visibility is validated in e2e tests.
});
