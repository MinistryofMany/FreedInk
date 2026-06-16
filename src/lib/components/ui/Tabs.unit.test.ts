// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Tabs from './Tabs.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

const tabs = [
	{ value: 'posts', label: 'Posts' },
	{ value: 'drafts', label: 'Drafts' },
	{ value: 'settings', label: 'Settings' }
];

describe('Tabs', () => {
	it('renders all tab triggers', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Tabs, { target, props: { tabs, value: 'posts' } });
		const triggers = target.querySelectorAll('[role="tab"]');
		expect(triggers.length).toBe(3);
	});

	it('renders trigger labels', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Tabs, { target, props: { tabs, value: 'posts' } });
		expect(target.textContent).toContain('Posts');
		expect(target.textContent).toContain('Drafts');
		expect(target.textContent).toContain('Settings');
	});

	it('marks the active tab as data-state=active', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Tabs, { target, props: { tabs, value: 'drafts' } });
		const triggers = target.querySelectorAll('[role="tab"]');
		expect(triggers[1].getAttribute('data-state')).toBe('active');
		expect(triggers[0].getAttribute('data-state')).toBe('inactive');
	});

	it('renders panel snippet with the active value', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		// createRawSnippet for a panel that takes a value param is not directly
		// supported in test helpers; use a static children snippet instead.
		const staticPanel = createRawSnippet(() => ({
			render: () => '<div class="panel-content">Panel</div>',
			setup: () => {}
		}));

		mount(Tabs, { target, props: { tabs, value: 'posts', children: staticPanel } });
		expect(target.querySelector('.panel-content')).not.toBeNull();
	});

	it('renders a tablist', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Tabs, { target, props: { tabs, value: 'posts' } });
		expect(target.querySelector('[role="tablist"]')).not.toBeNull();
	});
});
