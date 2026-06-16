// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Kicker from './Kicker.svelte';

const text = createRawSnippet(() => ({ render: () => '<span>eyebrow</span>' }));

function mountKicker(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Kicker, { target, props: { children: text, ...props } });
	return target;
}

afterEach(() => {
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('Kicker', () => {
	it('mounts without throwing and renders a span with kicker class', () => {
		const target = mountKicker();
		const el = target.querySelector('span.kicker');
		expect(el).not.toBeNull();
	});

	it('renders children content', () => {
		const target = mountKicker();
		expect(target.textContent).toContain('eyebrow');
	});

	it('forwards extra class prop', () => {
		const target = mountKicker({ class: 'section-label' });
		const el = target.querySelector('span.kicker');
		expect(el!.classList.contains('section-label')).toBe(true);
	});
});
