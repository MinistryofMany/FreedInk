// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Badge from './Badge.svelte';

const text = createRawSnippet(() => ({ render: () => '<span>status</span>' }));

function mountBadge(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Badge, { target, props: { children: text, ...props } });
	return target;
}

afterEach(() => {
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('Badge', () => {
	it('mounts without throwing and defaults to neutral tone', () => {
		const target = mountBadge();
		const el = target.querySelector('span.badge');
		expect(el).not.toBeNull();
		expect(el!.classList.contains('neutral')).toBe(true);
	});

	it('applies success class when tone is success', () => {
		const target = mountBadge({ tone: 'success' });
		const el = target.querySelector('span.badge');
		expect(el!.classList.contains('success')).toBe(true);
		expect(el!.classList.contains('neutral')).toBe(false);
	});

	it('applies warning class when tone is warning', () => {
		const target = mountBadge({ tone: 'warning' });
		const el = target.querySelector('span.badge');
		expect(el!.classList.contains('warning')).toBe(true);
	});

	it('applies danger class when tone is danger', () => {
		const target = mountBadge({ tone: 'danger' });
		const el = target.querySelector('span.badge');
		expect(el!.classList.contains('danger')).toBe(true);
	});

	it('forwards extra class prop', () => {
		const target = mountBadge({ class: 'extra' });
		const el = target.querySelector('span.badge');
		expect(el!.classList.contains('extra')).toBe(true);
	});
});
