// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Button from './Button.svelte';

const label = createRawSnippet(() => ({
	render: () => '<span>Click</span>',
	setup: () => {}
}));

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('Button', () => {
	it('renders a <button> by default', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Button, { target, props: { children: label } });
		expect(target.querySelector('button')).not.toBeNull();
		expect(target.querySelector('a')).toBeNull();
	});

	it('renders an <a> when href is set', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Button, { target, props: { href: '/test', children: label } });
		const a = target.querySelector('a');
		expect(a).not.toBeNull();
		expect(a!.getAttribute('href')).toBe('/test');
		expect(target.querySelector('button')).toBeNull();
	});

	it('applies the variant class', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Button, { target, props: { variant: 'ghost', children: label } });
		const btn = target.querySelector('button');
		expect(btn!.className).toContain('ghost');
	});

	it('disables the button when disabled=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Button, { target, props: { disabled: true, children: label } });
		const btn = target.querySelector('button') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
	});

	it('disables the button when loading=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Button, { target, props: { loading: true, children: label } });
		const btn = target.querySelector('button') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute('aria-busy')).toBe('true');
	});

	it('applies the size class', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Button, { target, props: { size: 'sm', children: label } });
		const btn = target.querySelector('button');
		expect(btn!.className).toContain('sm');
	});
});
