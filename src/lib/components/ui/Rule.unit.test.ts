// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import Rule from './Rule.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('Rule', () => {
	it('mounts and renders an hr element', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Rule, { target, props: {} });
		expect(target.querySelector('hr')).not.toBeNull();
	});

	it('applies the subtle class when subtle=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Rule, { target, props: { subtle: true } });
		const hr = target.querySelector('hr');
		expect(hr).not.toBeNull();
		expect(hr!.classList.contains('subtle')).toBe(true);
	});

	it('does not apply subtle class when subtle=false (default)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Rule, { target, props: {} });
		const hr = target.querySelector('hr');
		expect(hr!.classList.contains('subtle')).toBe(false);
	});

	it('forwards extra class prop', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Rule, { target, props: { class: 'my-divider' } });
		const hr = target.querySelector('hr');
		expect(hr!.classList.contains('my-divider')).toBe(true);
	});
});
