// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import { createRawSnippet } from 'svelte';
import EmptyState from './EmptyState.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('EmptyState', () => {
	it('mounts and renders the title', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(EmptyState, { target, props: { title: 'Nothing here yet' } });
		expect(target.textContent).toContain('Nothing here yet');
	});

	it('renders description when provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(EmptyState, {
			target,
			props: { title: 'No posts', description: 'Start writing to see posts here.' }
		});
		expect(target.textContent).toContain('No posts');
		expect(target.textContent).toContain('Start writing to see posts here.');
	});

	it('does not render description element when not provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(EmptyState, { target, props: { title: 'Empty' } });
		expect(target.querySelector('.empty-description')).toBeNull();
	});

	it('renders action snippet when provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const action = createRawSnippet(() => ({
			render: () => '<button>Create post</button>',
			setup: () => {}
		}));
		mount(EmptyState, { target, props: { title: 'Nothing here', action } });
		expect(target.querySelector('button')).not.toBeNull();
		expect(target.textContent).toContain('Create post');
	});

	it('does not render icon slot when no icon given', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(EmptyState, { target, props: { title: 'Empty' } });
		expect(target.querySelector('svg')).toBeNull();
	});
});
